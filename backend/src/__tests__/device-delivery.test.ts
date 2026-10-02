import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { managementRouter, feedRouter } from '../routes/deviceDelivery';
import { getApiKeys, getPreferences } from '../services/database';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { tokenHash, validateHeartbeat } from '../services/deviceDelivery';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
// @ts-expect-error The standalone reference client is deliberately dependency-free JavaScript.
import { createPoller } from '../../../tools/display-client.mjs';

const state = vi.hoisted(() => ({ deliveries: new Map<string, Record<string, unknown>>(), owners: new Map([['device-a', 'owner-a'], ['device-b', 'owner-b']]) }));
vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const owner = req.headers.authorization?.replace('Bearer ', '');
  if (owner !== 'owner-a' && owner !== 'owner-b') { res.status(401).json({ error: 'Unauthorized' }); return; }
  req.clerkUserId = owner; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: async (id: string) => id }));
vi.mock('../services/displayData', async (original) => ({ ...await original<typeof import('../services/displayData')>(), buildDisplayData: vi.fn() }));
vi.mock('../services/database', () => ({ getApiKeys: vi.fn(), getPreferences: vi.fn(), getSupabaseClient: () => ({ from: (table: string) => {
  const filters: Array<[string, unknown]> = []; let operation = ''; let update: Record<string, unknown> = {};
  const rows = () => table === 'devices' ? [...state.owners].map(([id, user_id]) => ({ id, user_id })) : table === 'device_delivery' ? [...state.deliveries.values()] : [];
  const matches = () => rows().filter((row) => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value));
  const query = {
    select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
    upsert: (value: Record<string, unknown>) => { operation = 'upsert'; update = value; return query; },
    update: (value: Record<string, unknown>) => { operation = 'update'; update = value; return query; },
    then: (resolve: (result: { error: null }) => unknown) => {
      if (operation === 'upsert') state.deliveries.set(String(update.device_id), { ...state.deliveries.get(String(update.device_id)), ...update });
      if (operation === 'update') for (const row of matches()) Object.assign(row, update);
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
  return query;
} }) }));

describe('authenticated device delivery', () => {
  let server: Server; let base: string;
  const ownerHeaders = { Authorization: 'Bearer owner-a', 'Content-Type': 'application/json' };
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/devices', managementRouter); app.use('/device-feed', feedRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    state.deliveries.clear(); vi.clearAllMocks();
    state.owners.set('device-a', 'owner-a'); state.owners.set('device-b', 'owner-b');
    vi.mocked(getApiKeys).mockResolvedValue([]);
    vi.mocked(getPreferences).mockResolvedValue({ ...DEFAULT_PREFS, layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6 }] } });
    vi.mocked(buildDisplayData).mockResolvedValue({ nextRefresh: 120000, news: [{ title: 'Live frame', url: '' }] });
  });
  const create = async () => {
    const response = await fetch(`${base}/devices/device-a/delivery/token`, { method: 'POST', headers: ownerHeaders });
    expect(response.status).toBe(200); return (await response.json() as { token: string }).token;
  };
  const frame = (token: string, extra: Record<string, string> = {}, id = 'device-a', format = 'raw') => fetch(`${base}/device-feed/${id}/frame?format=${format}`, { headers: { Authorization: `Bearer ${token}`, ...extra } });

  it('scopes management to the owner, stores only a hash, and makes rotation/revocation effective immediately', async () => {
    const token = await create(); expect(token).toMatch(/^einkd_[\w-]{43}$/);
    expect(state.deliveries.get('device-a')?.token_hash).toBe(tokenHash(token));
    expect(JSON.stringify([...state.deliveries.values()])).not.toContain(token);
    const status = await fetch(`${base}/devices/device-a/delivery`, { headers: ownerHeaders });
    const text = await status.text(); expect(text).not.toContain(tokenHash(token)); expect(JSON.parse(text).lastSeenAt).toBeNull();
    expect((await fetch(`${base}/devices/device-b/delivery/token`, { method: 'POST', headers: ownerHeaders })).status).toBe(404);
    expect((await fetch(`${base}/devices/device-b/delivery/token`, { method: 'DELETE', headers: ownerHeaders })).status).toBe(404);
    expect((await fetch(`${base}/devices/device-b/delivery`, { headers: ownerHeaders })).status).toBe(404);
    expect((await frame(token, {}, 'device-b')).status).toBe(401);
    const replacement = await create(); expect(replacement).not.toBe(token);
    expect((await frame(token)).status).toBe(401); expect((await frame(replacement)).status).toBe(200);
    expect(state.deliveries.get('device-a')?.last_seen_at).toBeNull();
    expect((await fetch(`${base}/devices/device-a/delivery/token`, { method: 'DELETE', headers: ownerHeaders })).status).toBe(200);
    expect((await frame(replacement)).status).toBe(401);
  });
  it('serves verifiable BMP/raw frames, dimensions and conditional 304 without claiming application', async () => {
    const token = await create(); const response = await frame(token);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes).toHaveLength(32 * 122); expect(response.headers.get('x-image-sha256')).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(response.headers.get('x-display-width')).toBe('250'); expect(response.headers.get('x-display-height')).toBe('122');
    expect(response.headers.get('retry-after')).toBe('120'); expect(response.headers.get('x-refresh-mode')).toBe('full');
    const unchanged = await frame(token, { 'If-None-Match': response.headers.get('etag')! });
    expect(unchanged.status).toBe(304); expect(await unchanged.text()).toBe('');
    const bmp = await frame(token, {}, 'device-a', 'bmp'); const bmpBytes = Buffer.from(await bmp.arrayBuffer());
    expect(bmpBytes.toString('ascii', 0, 2)).toBe('BM'); expect(bmpBytes.readInt32LE(18)).toBe(250);
    expect(state.deliveries.get('device-a')?.last_applied_hash).toBeNull();
  });
  it('validates reports and returns reported telemetry to the owner', async () => {
    const token = await create(); const report = { firmware_version: 'test/1.0', battery_percent: 45, rssi: -73, last_applied_hash: 'ab'.repeat(32) };
    const response = await fetch(`${base}/device-feed/device-a/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    expect(response.status).toBe(200);
    const status = await (await fetch(`${base}/devices/device-a/delivery`, { headers: ownerHeaders })).json();
    expect(status).toMatchObject({ firmwareVersion: 'test/1.0', batteryPercent: 45, rssi: -73, lastAppliedHash: 'ab'.repeat(32), lastSeenAt: expect.any(String) });
    const invalid = await fetch(`${base}/device-feed/device-a/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...report, battery_percent: 101 }) });
    expect(invalid.status).toBe(400);
    expect(state.deliveries.get('device-a')?.battery_percent).toBe(45);
  });
  it('clears an earlier applied image on explicit null, while omitted hashes from older clients remain unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const token = await create();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const heartbeat = (fields: Record<string, unknown>) => fetch(`${base}/device-feed/device-a/heartbeat`, {
      method: 'POST', headers, body: JSON.stringify({ firmware_version: 'test/1.1', ...fields }),
    });
    const status = async () => (await fetch(`${base}/devices/device-a/delivery`, { headers: ownerHeaders })).json();
    const hash = 'ab'.repeat(32);
    expect((await heartbeat({ last_applied_hash: hash, battery_percent: 45 })).status).toBe(200);
    expect(await status()).toMatchObject({ lastAppliedHash: hash, lastSeenAt: '2026-10-01T12:00:00.000Z' });

    vi.setSystemTime(new Date('2026-10-01T12:01:00Z'));
    expect((await heartbeat({})).status).toBe(200);
    expect(await status()).toMatchObject({ lastAppliedHash: hash, lastSeenAt: '2026-10-01T12:01:00.000Z' });

    vi.setSystemTime(new Date('2026-10-01T12:02:00Z'));
    expect((await heartbeat({ last_applied_hash: null })).status).toBe(200);
    expect(state.deliveries.get('device-a')?.last_applied_hash).toBeNull();
    expect(await status()).toMatchObject({ lastAppliedHash: null, batteryPercent: 45, lastSeenAt: '2026-10-01T12:02:00.000Z' });

    const recoveredHash = 'cd'.repeat(32);
    expect((await heartbeat({ last_applied_hash: recoveredHash })).status).toBe(200);
    expect(await status()).toMatchObject({ lastAppliedHash: recoveredHash });
  });
  it('accepts an explicitly unknown applied image without changing the meaning of omission', () => {
    expect(validateHeartbeat({ firmware_version: 'v1', last_applied_hash: null })).toEqual({ firmware_version: 'v1', last_applied_hash: null });
    expect(validateHeartbeat({ firmware_version: 'v1' })).not.toHaveProperty('last_applied_hash');
  });
  it('runs the real reference client against the API and withholds applied ACKs in file-only mode', async () => {
    const token = await create(); const directory = await mkdtemp(join(tmpdir(), 'eink-api-'));
    try {
      const poller = createPoller({ baseUrl: base, token, deviceId: 'device-a', width: 250, height: 122, outputFile: join(directory, 'frame.bmp'), allowHttpLocalhost: true });
      expect((await poller.pollOnce()).kind).toBe('updated'); expect((await readFile(join(directory, 'frame.bmp'))).toString('ascii', 0, 2)).toBe('BM');
      expect((await poller.pollOnce()).kind).toBe('unchanged');
      expect(state.deliveries.get('device-a')?.last_seen_at).toEqual(expect.any(String));
      expect(state.deliveries.get('device-a')?.last_applied_hash).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('sends quiet 204 before fetching credentials/sources and wakes at the quiet boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T23:00:00Z'));
    const layout = { version: 1 as const, cols: 10 as const, rows: 6 as const, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6 }] };
    vi.mocked(getPreferences).mockResolvedValue({ ...DEFAULT_PREFS, display_schedule: { enabled: true, timezone: 'UTC', pages: [{ id: 'page', name: 'Page', duration_seconds: 60, layout }], quiet_hours: { enabled: true, start: '22:00', end: '06:00' } } });
    const response = await frame(await create());
    expect(response.status).toBe(204); expect(await response.text()).toBe(''); expect(response.headers.get('retry-after')).toBe('25200');
    expect(getApiKeys).not.toHaveBeenCalled(); expect(buildDisplayData).not.toHaveBeenCalled();
  });
  it('does not carry an earlier owner token or reports across device reassignment', async () => {
    const token = await create(); state.owners.set('device-a', 'owner-b');
    expect((await frame(token)).status).toBe(401);
    const status = await (await fetch(`${base}/devices/device-a/delivery`, { headers: { Authorization: 'Bearer owner-b' } })).json();
    expect(status).toMatchObject({ configured: false, lastSeenAt: null, lastAppliedHash: null });
  });
  it('uses the page attached to collected data and subtracts elapsed rendering time from the next boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:59Z'));
    const primary = { version: 1 as const, cols: 10 as const, rows: 6 as const, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6 }] };
    const page = { ...primary, widgets: [{ i: 'weather', x: 0, y: 0, w: 10, h: 6 }] };
    const selected = { ...DEFAULT_PREFS, layout: primary, display_schedule: { enabled: true, timezone: 'UTC', pages: [{ id: 'weather-page', name: 'Weather', duration_seconds: 60, layout: page }], quiet_hours: { enabled: false, start: '22:00', end: '06:00' } } };
    const data = { nextRefresh: 1000, weather: { temp: 12, condition: 'Sunny', windSpeed: 2, icon: '' }, schedule: { pageId: 'weather-page', pageName: 'Weather', quiet: false, nextTransitionAt: '2026-09-28T12:01:00Z' } };
    vi.mocked(getPreferences).mockResolvedValue(selected);
    vi.mocked(buildDisplayData).mockImplementation(async () => { vi.setSystemTime(new Date('2026-09-28T12:00:59.800Z')); return data; });
    const response = await frame(await create());
    expect(response.status).toBe(200); expect(response.headers.get('retry-after')).toBe('1');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(renderDisplayDataRaw(data, page, selected));
  });
  it.each([{ firmware_version: '' }, { firmware_version: 'v1', battery_percent: 101 }, { firmware_version: 'v1', rssi: -151 }, { firmware_version: 'v1', rssi: -1.5 }, { firmware_version: 'v1', last_applied_hash: 'invalid' }, { firmware_version: 'v1', last_applied_hash: '' }, { firmware_version: 'v1', last_applied_hash: false }, { firmware_version: 'v1', last_applied_hash: 0 }, { firmware_version: 'v1', last_applied_hash: 'AB'.repeat(32) }, { firmware_version: 'v1', user_id: 'other' }])('rejects malformed telemetry %j', (body) => {
    expect(() => validateHeartbeat(body)).toThrow();
  });
});
