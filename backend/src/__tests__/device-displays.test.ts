import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClerkClient } from '@clerk/backend';
import { getApiKeys, getPreferences, getUserByEmail, upsertUser } from '../services/database';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { getDeviceDisplay, resolveDevicePreferences, saveDeviceDisplay } from '../services/deviceDisplays';
import { resolveDisplaySchedule } from '../services/displaySchedule';
import deviceDisplaysRouter from '../routes/deviceDisplays';
import imageRouter from '../routes/image';
import previewRouter from '../routes/display-data';
import { feedRouter } from '../routes/deviceDelivery';
import { errorHandler } from '../middleware/errorHandler';
import type { DisplayData, DisplayLayout, DisplaySchedule, User, UserPreferences } from '../types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const state = vi.hoisted(() => ({
  owners: new Map<string, string>(), rows: new Map<string, Record<string, unknown>>(),
  error: null as null | { code: string; message: string }, writes: 0, transferOnWrite: false,
}));
vi.mock('@clerk/backend', () => ({ createClerkClient: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.headers.authorization !== 'Bearer owner') { res.status(401).json({ error: 'Unauthorized' }); return; }
  req.clerkUserId = 'owner'; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: async (id: string) => id }));
vi.mock('../services/displayData', async (original) => ({ ...await original<typeof import('../services/displayData')>(), buildDisplayData: vi.fn() }));
vi.mock('../services/deviceDelivery', async (original) => ({ ...await original<typeof import('../services/deviceDelivery')>(),
  authenticateDevice: async (id: string, auth: string) => auth === 'Bearer device-token' ? state.owners.get(id) ?? null : null,
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/database', () => ({
  getPreferences: vi.fn(), getApiKeys: vi.fn(), upsertUser: vi.fn(), getUserByEmail: vi.fn(), logApiUsage: vi.fn(),
  getSupabaseClient: () => ({ from: (table: string) => {
    const filters: Array<[string, unknown]> = []; let operation = ''; let values: Record<string, unknown> = {};
    const read = () => table === 'devices' ? [...state.owners].map(([id, user_id]) => ({ id, user_id })) : table === 'device_displays' ? [...state.rows.values()] : [];
    const matches = () => read().filter((row) => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value));
    const execute = async () => {
      if (table === 'device_displays' && state.error) return { data: null, error: state.error };
      if (operation) {
        state.writes++;
        if (state.transferOnWrite) return { data: null, error: { code: '23503' } };
        if (operation === 'insert') {
          if (state.rows.has(String(values.device_id))) return { data: null, error: { code: '23505' } };
          state.rows.set(String(values.device_id), { ...values });
          return { data: values, error: null };
        }
        const row = matches()[0];
        if (row) Object.assign(row, values);
        return { data: row ?? null, error: null };
      }
      const row = matches()[0];
      return { data: row ? structuredClone(row) : null, error: null };
    };
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: execute, single: execute,
      insert: (value: Record<string, unknown>) => { operation = 'insert'; values = value; return query; },
      update: (value: Record<string, unknown>) => { operation = 'update'; values = value; return query; },
    };
    return query;
  } }),
}));

const baseLayout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 10, h: 6 }] };
const otherLayout: DisplayLayout = { ...baseLayout, widgets: [{ i: 'weather', x: 0, y: 0, w: 10, h: 6 }] };
const schedule: DisplaySchedule = { enabled: false, timezone: 'UTC',
  quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
  pages: [
    { id: 'price', name: 'Price', layout: baseLayout, duration_seconds: 60 },
    { id: 'weather', name: 'Weather', layout: otherLayout, duration_seconds: 60 },
  ],
};
const initial = () => ({ ...DEFAULT_PREFS, layout: baseLayout, display_schedule: schedule });
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

beforeEach(() => {
  vi.clearAllMocks(); state.rows.clear(); state.error = null; state.writes = 0; state.transferOnWrite = false;
  state.owners.clear(); state.owners.set(A, 'owner'); state.owners.set(B, 'owner'); state.owners.set(FOREIGN, 'other');
  vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
  vi.mocked(createClerkClient).mockReturnValue({ users: { getUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: 'owner@example.com' }] }) } } as unknown as ReturnType<typeof createClerkClient>);
  vi.mocked(getPreferences).mockResolvedValue(initial());
  vi.mocked(upsertUser).mockResolvedValue({ id: 'owner' } as User);
  vi.mocked(getUserByEmail).mockResolvedValue({ id: 'owner' } as User);
  vi.mocked(getApiKeys).mockResolvedValue([{ provider: 'openweathermap', api_key: 'saved-owner-key' }] as Awaited<ReturnType<typeof getApiKeys>>);
  vi.mocked(buildDisplayData).mockImplementation(async (_owner, prefs) => {
    const resolved = resolveDisplaySchedule(prefs);
    return { nextRefresh: resolved.nextRefresh, ...(resolved.schedule ? { schedule: resolved.schedule } : {}),
      price: { now: 25, average: 50, trend: 'down' }, weather: { temp: 8, condition: 'Clear', windSpeed: 2, icon: '01d' } };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('device display persistence', () => {
  it('inherits exact legacy presentation and snapshots it only when first customized', async () => {
    expect(await getDeviceDisplay('owner', A)).toEqual({ preferences: { ...initial(), active_layout_id: null }, inherited: true });
    expect(state.writes).toBe(0);
    const saved = await saveDeviceDisplay('owner', A, { display_timezone: 'America/New_York' });
    expect(saved).toMatchObject({ inherited: false, preferences: { layout: baseLayout, display_timezone: 'America/New_York', refresh_interval_minutes: 30 } });
    expect(state.rows.get(A)).not.toHaveProperty('weather_location');
    vi.mocked(getPreferences).mockResolvedValue({ ...initial(), layout: otherLayout, display_timezone: 'UTC', weather_location: '0,0' });
    expect(await getDeviceDisplay('owner', A)).toMatchObject({ preferences: { layout: baseLayout, display_timezone: 'America/New_York', weather_location: '0,0' } });
    expect(await getDeviceDisplay('owner', B)).toMatchObject({ inherited: true, preferences: { layout: otherLayout, display_timezone: 'UTC' } });
  });

  it('resolves independently selected pages but keeps base layouts available for editing', async () => {
    await saveDeviceDisplay('owner', A, { active_layout_id: 'weather' });
    await saveDeviceDisplay('owner', B, { active_layout_id: 'price', refresh_interval_minutes: 2 });
    expect((await getDeviceDisplay('owner', A)).preferences.layout).toEqual(baseLayout);
    expect((await resolveDevicePreferences('owner', A)).layout).toEqual(otherLayout);
    expect((await resolveDevicePreferences('owner', B)).layout).toEqual(baseLayout);
    expect((await resolveDevicePreferences('owner')).layout).toEqual(baseLayout);
  });

  it('rejects removal of an active page unless a replacement is submitted atomically', async () => {
    await saveDeviceDisplay('owner', A, { active_layout_id: 'weather' });
    const fewer = { ...schedule, pages: [schedule.pages[0]] };
    await expect(saveDeviceDisplay('owner', A, { display_schedule: fewer })).rejects.toMatchObject({ statusCode: 400 });
    expect(state.rows.get(A)?.active_layout_id).toBe('weather');
    await saveDeviceDisplay('owner', A, { display_schedule: fewer, active_layout_id: 'price' });
    expect((await resolveDevicePreferences('owner', A)).layout).toEqual(baseLayout);
    await saveDeviceDisplay('owner', A, { display_schedule: { ...schedule, pages: [] }, active_layout_id: null });
    expect((await getDeviceDisplay('owner', A)).preferences.active_layout_id).toBeNull();
  });

  it('ignores and safely replaces an old-owner row without copying its settings', async () => {
    await saveDeviceDisplay('owner', A, { active_layout_id: 'weather', display_timezone: 'America/New_York' });
    state.rows.get(A)!.owner_id = 'old-owner';
    expect(await getDeviceDisplay('owner', A)).toMatchObject({ inherited: true, preferences: { active_layout_id: null, display_timezone: 'Europe/Copenhagen' } });
    await saveDeviceDisplay('owner', A, { refresh_interval_minutes: 5 });
    expect(state.rows.get(A)).toMatchObject({ owner_id: 'owner', active_layout_id: null, display_timezone: 'Europe/Copenhagen', refresh_interval_minutes: 5 });
  });

  it.each([false, true])('rejects a concurrent %s save without overwriting its winner', async (existing) => {
    if (existing) await saveDeviceDisplay('owner', A, { active_layout_id: 'price' });
    const attempts = await Promise.allSettled([
      saveDeviceDisplay('owner', A, { display_timezone: 'UTC' }),
      saveDeviceDisplay('owner', A, { refresh_interval_minutes: 5 }),
    ]);
    expect(attempts.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(attempts[1]).toMatchObject({ reason: { statusCode: 409 } });
    expect(state.rows.get(A)).toMatchObject({ display_timezone: 'UTC', refresh_interval_minutes: 30 });
    await saveDeviceDisplay('owner', A, { refresh_interval_minutes: 5 });
    expect(state.rows.get(A)).toMatchObject({ display_timezone: 'UTC', refresh_interval_minutes: 5 });
  });

  it.each(['42P01', 'PGRST205'])('keeps unmigrated devices working only for missing-table code %s', async (code) => {
    state.error = { code, message: 'missing table' };
    expect(await getDeviceDisplay('owner', A)).toMatchObject({ inherited: true, preferences: { layout: baseLayout } });
    await expect(saveDeviceDisplay('owner', A, { display_timezone: 'UTC' })).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('018') });
    expect(state.writes).toBe(0);
  });

  it('reports an ownership change rejected atomically by the database as missing device', async () => {
    state.transferOnWrite = true;
    await expect(saveDeviceDisplay('owner', A, { display_timezone: 'UTC' })).rejects.toMatchObject({ statusCode: 404 });
    expect(state.rows.size).toBe(0);
  });

  it('propagates other storage failures instead of rendering a different layout', async () => {
    state.error = { code: '08006', message: 'connection lost' };
    await expect(getDeviceDisplay('owner', A)).rejects.toMatchObject({ code: '08006' });
  });
});

describe('device presentation API and render paths', () => {
  let server: Server; let base: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json({ limit: '40kb' }));
    app.use('/devices', deviceDisplaysRouter); app.use('/image', imageRouter); app.use('/preview', previewRouter); app.use('/device-feed', feedRouter); app.use(errorHandler);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const get = (path: string) => fetch(base + path, { headers });
  const put = (body: unknown, id = A) => fetch(`${base}/devices/${id}/display`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const frame = (id = A, format = 'bmp') => fetch(`${base}/device-feed/${id}/frame?format=${format}`, { headers: { Authorization: 'Bearer device-token' } });

  it('requires authentication and validates ownership before reading private preferences', async () => {
    expect((await fetch(`${base}/devices/${A}/display`)).status).toBe(401);
    expect((await get(`/devices/${FOREIGN}/display`)).status).toBe(404);
    expect((await put({ display_timezone: 'UTC' }, FOREIGN)).status).toBe(404);
    for (const path of ['/preview', '/image/preview', '/image/preview/raw']) {
      expect((await get(`${path}?device_id=${FOREIGN}`)).status).toBe(404);
      expect((await get(`${path}?device_id=${A}&device_id=${B}`)).status).toBe(400);
      expect((await get(`${path}?device_id=`)).status).toBe(400);
    }
    expect(getPreferences).not.toHaveBeenCalled(); expect(buildDisplayData).not.toHaveBeenCalled();
  });

  it.each([
    {}, [], { owner_id: 'other' }, { weather_location: '0,0' }, { active_layout_id: 42 }, { active_layout_id: 'missing' },
    { refresh_interval_minutes: 0 }, { display_timezone: 'No/Such_Zone' }, { display_profile: { width: 0 } },
    { display_schedule: { ...schedule, enabled: true, pages: [] } },
  ])('rejects invalid/non-presentation updates without persistence: %j', async (body) => {
    expect((await put(body)).status).toBe(400); expect(state.writes).toBe(0);
  });

  it('returns full scoped preferences and keeps credentials out of its response', async () => {
    const response = await put({ active_layout_id: 'weather' });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as { preferences: Record<string, unknown>; inherited: boolean };
    expect(body).toMatchObject({ inherited: false, preferences: { active_layout_id: 'weather', weather_location: '55.3,10.4' } });
    expect(JSON.stringify(body)).not.toContain('saved-owner-key');
    expect(body.preferences).not.toHaveProperty('owner_id'); expect(body.preferences).not.toHaveProperty('revision');
  });

  it('renders identical selected-device BMP/raw pixels for previews and automatic delivery', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-02T12:00:00Z').getTime());
    await saveDeviceDisplay('owner', A, { active_layout_id: 'weather', display_timezone: 'UTC', refresh_interval_minutes: 4 });
    for (const format of ['bmp', 'raw']) {
      const preview = await get(`/image/preview${format === 'raw' ? '/raw' : ''}?device_id=${A}`);
      const frame = await fetch(`${base}/device-feed/${A}/frame?format=${format}`, { headers: { Authorization: 'Bearer device-token' } });
      expect(preview.status).toBe(200); expect(frame.status).toBe(200);
      expect(Buffer.from(await preview.arrayBuffer())).toEqual(Buffer.from(await frame.arrayBuffer()));
    }
    const selected = await get(`/image/preview?device_id=${A}`); const legacy = await get('/image/preview');
    expect(Buffer.from(await selected.arrayBuffer())).not.toEqual(Buffer.from(await legacy.arrayBuffer()));
    expect((await get(`/preview?device_id=${A}`)).status).toBe(200);
    expect(buildDisplayData).toHaveBeenCalledWith('owner', expect.objectContaining({ layout: otherLayout, refresh_interval_minutes: 4 }), { openweathermap: 'saved-owner-key' });
  });

  it('keeps rotating pages independent of the fixed selection', async () => {
    await saveDeviceDisplay('owner', A, { active_layout_id: 'weather', display_schedule: { ...schedule, enabled: true } });
    const preferences = await resolveDevicePreferences('owner', A);
    expect(resolveDisplaySchedule(preferences, new Date(0)).layout).toEqual(baseLayout);
    expect(resolveDisplaySchedule(preferences, new Date(60000)).layout).toEqual(otherLayout);
  });

  it('delivers independent page order and durations with matching BMP/raw previews at exact boundaries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse('2026-10-02T12:00:00Z');
    vi.setSystemTime(start);
    const pages = [schedule.pages[0], { ...schedule.pages[1], duration_seconds: 120 }];
    expect((await put({ display_schedule: { ...schedule, enabled: true, pages } }, A)).status).toBe(200);
    expect((await put({ display_schedule: { ...schedule, enabled: true, pages: [...pages].reverse() } }, B)).status).toBe(200);
    for (const [offset, pageA, pageB, delayA, delayB] of [
      [0, 'price', 'weather', 60, 120],
      [59_999, 'price', 'weather', 1, 61],
      [60_000, 'weather', 'weather', 120, 60],
      [120_000, 'weather', 'price', 60, 60],
      [180_000, 'price', 'weather', 60, 120],
    ] as const) {
      vi.setSystemTime(start + offset);
      for (const [id, pageId, delay] of [[A, pageA, delayA], [B, pageB, delayB]] as const) {
        const data = await (await get(`/preview?device_id=${id}`)).json() as DisplayData;
        expect(data.schedule).toMatchObject({ pageId, quiet: false });
        for (const format of ['bmp', 'raw']) {
          const delivered = await frame(id, format);
          const preview = await get(`/image/preview${format === 'raw' ? '/raw' : ''}?device_id=${id}`);
          expect(delivered.status).toBe(200);
          expect(delivered.headers.get('retry-after')).toBe(String(delay));
          expect(Buffer.from(await delivered.arrayBuffer())).toEqual(Buffer.from(await preview.arrayBuffer()));
        }
      }
    }
    // Per-device changes never rewrite the account-level template or its order.
    expect((await resolveDevicePreferences('owner')).display_schedule).toEqual(schedule);
  });

  it('pins a collected page through a fetch crossing its boundary and asks the device to retry promptly', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:59Z'));
    expect((await put({ display_schedule: { ...schedule, enabled: true } })).status).toBe(200);
    const before = Buffer.from(await (await get(`/image/preview?device_id=${A}`)).arrayBuffer());
    const collect = vi.mocked(buildDisplayData).getMockImplementation()!;
    vi.mocked(buildDisplayData).mockImplementationOnce(async (...args) => {
      const data = await collect(...args);
      vi.setSystemTime(new Date('2026-10-02T12:01:01.250Z'));
      return data;
    });
    const crossing = await frame();
    expect(crossing.status).toBe(200);
    expect(crossing.headers.get('retry-after')).toBe('1');
    expect(Buffer.from(await crossing.arrayBuffer())).toEqual(before);
    const next = await frame();
    const after = Buffer.from(await next.arrayBuffer());
    expect(next.headers.get('retry-after')).toBe('59');
    expect(after).not.toEqual(before);
    expect(after).toEqual(Buffer.from(await (await get(`/image/preview?device_id=${A}`)).arrayBuffer()));
  });

  it('uses the shorter source refresh interval within a long page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const pages = schedule.pages.map((page) => ({ ...page, duration_seconds: 300 }));
    expect((await put({ display_schedule: { ...schedule, enabled: true, pages }, refresh_interval_minutes: 2 })).status).toBe(200);
    expect((await frame()).headers.get('retry-after')).toBe('120');
    vi.setSystemTime(new Date('2026-10-02T12:04:59.500Z'));
    expect((await frame()).headers.get('retry-after')).toBe('1');
  });

  it.each([
    ['2026-03-28T21:00:00Z', 8 * 3600],
    ['2026-10-24T20:00:00Z', 10 * 3600],
  ])('pauses only the selected device across its local DST quiet window at %s', async (at, seconds) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    const quiet = { enabled: true, start: '22:00', end: '07:00' };
    expect((await put({ display_schedule: { ...schedule, enabled: true, timezone: 'Europe/Copenhagen', quiet_hours: quiet } }, A)).status).toBe(200);
    expect((await put({ display_schedule: { ...schedule, enabled: true, timezone: 'UTC', quiet_hours: quiet } }, B)).status).toBe(200);
    const paused = await frame(A);
    expect(paused.status).toBe(204); expect(await paused.text()).toBe('');
    expect(paused.headers.get('retry-after')).toBe(String(seconds));
    expect(buildDisplayData).not.toHaveBeenCalled(); expect(getApiKeys).not.toHaveBeenCalled();
    const awake = await frame(B);
    expect(awake.status).toBe(200);
    expect(buildDisplayData).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.parse(at) + seconds * 1000);
    expect((await frame(A)).status).toBe(200);
  });

  it('suppresses a frame if collection enters this device’s quiet hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T21:59:59.500Z'));
    expect((await put({ display_schedule: { ...schedule, enabled: true,
      quiet_hours: { enabled: true, start: '22:00', end: '07:00' } } })).status).toBe(200);
    const collect = vi.mocked(buildDisplayData).getMockImplementation()!;
    vi.mocked(buildDisplayData).mockImplementationOnce(async (...args) => {
      const data = await collect(...args);
      vi.setSystemTime(new Date('2026-10-02T22:00:00.500Z'));
      return data;
    });
    const response = await frame();
    expect(response.status).toBe(204);
    expect(response.headers.get('retry-after')).toBe('32400');
    expect(response.headers.get('etag')).toBeNull(); expect(await response.text()).toBe('');
  });

  it('restores the selected fixed layout when rotation stops and preserves pages when it resumes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const rotating = { ...schedule, enabled: true };
    expect((await put({ active_layout_id: 'weather', display_schedule: rotating, refresh_interval_minutes: 4 }, A)).status).toBe(200);
    expect((await put({ display_schedule: rotating }, B)).status).toBe(200);
    const rotatingPixels = Buffer.from(await (await frame(A)).arrayBuffer());
    expect((await put({ display_schedule: { ...rotating, enabled: false } }, A)).status).toBe(200);
    const fixed = await frame(A); const fixedPixels = Buffer.from(await fixed.arrayBuffer());
    expect(fixed.headers.get('retry-after')).toBe('240');
    expect(fixedPixels).not.toEqual(rotatingPixels);
    expect(fixedPixels).toEqual(Buffer.from(await (await get(`/image/preview?device_id=${A}`)).arrayBuffer()));
    expect(Buffer.from(await (await frame(B)).arrayBuffer())).toEqual(rotatingPixels);
    expect((await put({ display_schedule: rotating }, A)).status).toBe(200);
    expect(Buffer.from(await (await frame(A)).arrayBuffer())).toEqual(rotatingPixels);
    const saved = await (await get(`/devices/${A}/display`)).json() as { preferences: UserPreferences };
    expect(saved.preferences).toMatchObject({ active_layout_id: 'weather', display_schedule: rotating });
  });

  it('uses selected-device dimensions for a draft without modifying saved presentation', async () => {
    await saveDeviceDisplay('owner', A, { active_layout_id: 'weather', display_profile: { width: 400, height: 300, rotation: 0, colorMode: 'bw' } });
    const writes = state.writes;
    const response = await fetch(`${base}/image/preview/draft`, { method: 'POST', headers, body: JSON.stringify({ device_id: A, layout: baseLayout }) });
    expect(response.status).toBe(200);
    const bmp = Buffer.from(await response.arrayBuffer());
    expect(bmp.readInt32LE(18)).toBe(400); expect(Math.abs(bmp.readInt32LE(22))).toBe(300);
    expect(state.writes).toBe(writes);
    expect((await getDeviceDisplay('owner', A)).preferences.active_layout_id).toBe('weather');
    expect(buildDisplayData).toHaveBeenCalledWith('owner', expect.objectContaining({ display_schedule: null, active_layout_id: null }), expect.any(Object));
    expect((await fetch(`${base}/image/preview/draft`, { method: 'POST', headers, body: JSON.stringify({ device_id: FOREIGN, layout: baseLayout }) })).status).toBe(404);
  });

  it('identifies fixed-device, shared-base and draft images with native profile metadata', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const renderedAt = '2026-10-02T12:00:00.000Z'; vi.setSystemTime(new Date(renderedAt));
    expect((await put({ active_layout_id: 'weather', display_profile: { width: 400, height: 300, rotation: 90, colorMode: 'bw' } })).status).toBe(200);
    for (const path of ['/image/preview', '/image/preview/raw']) {
      const fixed = await get(`${path}?device_id=${A}`);
      expect(fixed.status).toBe(200);
      expect(Object.fromEntries(fixed.headers)).toMatchObject({
        'x-preview-device-id': A, 'x-preview-layout-id': 'weather', 'x-preview-layout-name': 'Weather',
        'x-preview-mode': 'single', 'x-preview-rendered-at': renderedAt, 'x-preview-quiet': 'false',
        'x-display-width': '400', 'x-display-height': '300', 'x-display-rotation': '90',
        'x-display-encoding': 'mono-msb-white1', 'x-display-row-bytes': '50',
      });
      expect(fixed.headers.get('x-preview-next-transition')).toBeNull();
      const shared = await get(path);
      expect(Object.fromEntries(shared.headers)).toMatchObject({
        'x-preview-device-id': '', 'x-preview-layout-id': '', 'x-preview-layout-name': 'Base%20layout',
        'x-preview-mode': 'single', 'x-preview-rendered-at': renderedAt,
        'x-display-width': '250', 'x-display-height': '122', 'x-display-rotation': '0',
      });
    }
    const draft = await fetch(`${base}/image/preview/draft`, { method: 'POST', headers, body: JSON.stringify({ device_id: A, layout: baseLayout }) });
    expect(Object.fromEntries(draft.headers)).toMatchObject({
      'x-preview-device-id': A, 'x-preview-layout-id': '', 'x-preview-layout-name': 'Draft',
      'x-preview-mode': 'draft', 'x-preview-quiet': 'false', 'x-preview-rendered-at': renderedAt,
      'x-display-width': '400', 'x-display-height': '300', 'x-display-rotation': '90',
    });
    expect(draft.headers.get('x-preview-next-transition')).toBeNull();
  });

  it.each(['/image/preview', '/image/preview/raw'])('keeps %s metadata paired with the rendered page across a transition', async (path) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const before = new Date('2026-10-02T12:00:59Z'); vi.setSystemTime(before);
    const pageName = 'Køkken ☀ / Pris\r\nIngen header';
    const pages = [{ ...schedule.pages[0], name: pageName }, schedule.pages[1]];
    expect((await put({ display_schedule: { ...schedule, enabled: true, pages } })).status).toBe(200);
    const original = await get(`${path}?device_id=${A}`);
    const expectedPixels = Buffer.from(await original.arrayBuffer());
    const collect = vi.mocked(buildDisplayData).getMockImplementation()!;
    vi.mocked(buildDisplayData).mockImplementationOnce(async (...args) => {
      const data = await collect(...args);
      vi.setSystemTime(new Date('2026-10-02T12:01:01Z'));
      return data;
    });
    const response = await get(`${path}?device_id=${A}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expectedPixels);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'x-preview-device-id': A, 'x-preview-layout-id': 'price', 'x-preview-layout-name': encodeURIComponent(pageName),
      'x-preview-mode': 'slideshow', 'x-preview-quiet': 'false',
      'x-preview-rendered-at': '2026-10-02T12:01:01.000Z', 'x-preview-next-transition': '2026-10-02T12:01:00.000Z',
    });
    const next = await get(`${path}?device_id=${A}`);
    expect(next.headers.get('x-preview-layout-id')).toBe('weather');
    expect(Buffer.from(await next.arrayBuffer())).not.toEqual(expectedPixels);
  });

  it('reports quiet-hour preview state while drafts remain independent of the schedule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T22:30:00Z'));
    expect((await put({ display_schedule: { ...schedule, enabled: true,
      quiet_hours: { enabled: true, start: '22:00', end: '07:00' } } })).status).toBe(200);
    const quiet = await get(`/image/preview?device_id=${A}`);
    expect(quiet.status).toBe(200);
    expect(Object.fromEntries(quiet.headers)).toMatchObject({
      'x-preview-mode': 'slideshow', 'x-preview-quiet': 'true', 'x-preview-next-transition': '2026-10-03T07:00:00.000Z',
    });
    const draft = await fetch(`${base}/image/preview/draft`, { method: 'POST', headers, body: JSON.stringify({ device_id: A, layout: baseLayout }) });
    expect(draft.headers.get('x-preview-mode')).toBe('draft'); expect(draft.headers.get('x-preview-quiet')).toBe('false');
    expect(draft.headers.get('x-preview-next-transition')).toBeNull();
  });

  it('encodes malformed Unicode names safely rather than failing image generation', async () => {
    expect((await put({ active_layout_id: 'price', display_schedule: { ...schedule,
      pages: [{ ...schedule.pages[0], name: 'Name\ud800' }] } })).status).toBe(200);
    const response = await get(`/image/preview?device_id=${A}`);
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get('x-preview-layout-name')!)).toBe('Name�');
  });
});
