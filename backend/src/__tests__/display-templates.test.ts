import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { verifyToken } from '@clerk/backend';
import templatesRouter from '../routes/templates';
import { getOrCreateUserFromClerk } from '../routes/preferences-helpers';
import { getPreferences, upsertPreferences } from '../services/database';
import { DEFAULT_PREFS } from '../services/displayData';
import { exportDisplayTemplate, parseDisplayTemplate, STARTER_TEMPLATES } from '../utils/displayTemplates';
import type { UserPreferences } from '../types';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn() }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const template = { format: 'esp32-eink-template', version: 1, settings: exportDisplayTemplate(DEFAULT_PREFS).settings };
const withSettings = (settings: unknown) => ({ ...template, settings });
const schedule = {
  enabled: true, timezone: 'Europe/Copenhagen',
  pages: [{ id: 'energy', name: 'Electricity', duration_seconds: 900, layout: STARTER_TEMPLATES[0].template.settings.layout }],
  quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
  vi.mocked(verifyToken).mockResolvedValue({ sub: 'clerk-owner' } as Awaited<ReturnType<typeof verifyToken>>);
  vi.mocked(getOrCreateUserFromClerk).mockResolvedValue('owner');
  vi.mocked(getPreferences).mockResolvedValue(DEFAULT_PREFS);
  vi.mocked(upsertPreferences).mockResolvedValue(DEFAULT_PREFS);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('portable display template schema', () => {
  it('round-trips supported settings, a layout and a monochrome panel profile', () => {
    const prefs = {
      ...DEFAULT_PREFS, layout: STARTER_TEMPLATES[0].template.settings.layout,
      display_profile: { width: 400, height: 300, rotation: 90, colorMode: 'bw' },
      display_schedule: schedule,
    } as UserPreferences;
    const exported = exportDisplayTemplate(prefs);
    expect(parseDisplayTemplate(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    expect(exported.settings).toMatchObject({ layout: prefs.layout, display_profile: prefs.display_profile, display_schedule: schedule });
  });

  it('exports migrated rows with a null profile as the default profile', () => {
    expect(exportDisplayTemplate({ ...DEFAULT_PREFS, display_profile: null }).settings.display_profile).toEqual({ width: 250, height: 122, rotation: 0, colorMode: 'bw' });
  });

  it('round-trips a full twelve-page schedule above the old 8 KiB limit', () => {
    const widgets = ['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'custom-text', 'custom-image', 'status'].map((i, x) => ({ i, x, y: 0, w: 1, h: 1, static: true }));
    const large = withSettings({ display_schedule: { ...schedule, pages: Array.from({ length: 12 }, (_, i) => ({ id: `page-${i}`, name: 'A'.repeat(80), duration_seconds: 900, layout: { version: 1, cols: 10, rows: 6, widgets } })) } });
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(8192);
    expect(parseDisplayTemplate(large).settings.display_schedule?.pages).toHaveLength(12);
  });

  it('only exports safe settings even when a database row contains secrets or identifiers', () => {
    const prefs = {
      ...DEFAULT_PREFS, user_id: 'private-user', device_id: 'private-device', api_keys: { secret: 'private-token' },
      integration_token: 'private-token', news_feed_url: 'https://example.com/private-feed?key=private-token',
      calendar_url: 'https://calendar.example.com/private-token', unknown_future_secret: 'private-token',
    } as UserPreferences;
    const exported = JSON.stringify(exportDisplayTemplate(prefs));
    expect(exported).not.toContain('private');
    expect(exported).not.toContain('secret');
    expect(exported).not.toContain('example.com');
  });

  it('provides valid, independently editable starter layouts', () => {
    for (const starter of STARTER_TEMPLATES) expect(parseDisplayTemplate(starter.template)).toEqual(starter.template);
    expect(STARTER_TEMPLATES).toHaveLength(2);
  });

  it.each([
    null, [], {}, { ...template, format: 'unknown' }, { ...template, version: 2 }, { ...template, extra: 'unknown' },
    withSettings(null), withSettings([]), withSettings({}), withSettings({ user_id: 'victim' }),
    withSettings({ api_key: 'secret' }), withSettings({ calendar_url: 'https://private' }), withSettings({ show_weather: 'true' }),
    withSettings({ energy_price_location: 'UK' }), withSettings({ weather_location: '91,0' }), withSettings({ weather_location: '0,-181' }),
    withSettings({ weather_location: ',0' }), withSettings({ weather_location: '0,0,0' }), withSettings({ news_language: 'unknown' }), withSettings({ calendar_timezone: 'Invalid' }), withSettings({ calendar_days: 0 }), withSettings({ calendar_item_limit: 11 }),
    withSettings({ refresh_interval_minutes: 0 }), withSettings({ refresh_interval_minutes: 1441 }), withSettings({ refresh_interval_minutes: 1.5 }),
    withSettings({ monta_fields: ['password'] }), withSettings({ monta_fields: ['today_stats', 'today_stats'] }), withSettings({ zaptec_fields: ['today_stats'] }),
    withSettings({ layout: { version: 1, cols: 10, rows: 6, widgets: [], secret: 'token' } }),
    withSettings({ layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 10, h: 1, secret: 'token' }] } }),
    withSettings({ layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 11, h: 1 }] } }),
    withSettings({ display_profile: { width: 63, height: 122, rotation: 0, colorMode: 'bw' } }),
    withSettings({ display_profile: { width: 1600, height: 1600, rotation: 0, colorMode: 'bw' } }),
    withSettings({ display_profile: { width: 250, height: 122, rotation: 45, colorMode: 'bw' } }),
    withSettings({ display_profile: { width: 250, height: 122, rotation: 0, colorMode: 'bwr' } }),
    withSettings({ display_profile: { width: 250, height: 122, rotation: 0, colorMode: 'bw', token: 'secret' } }),
    withSettings({ display_schedule: { ...schedule, timezone: 'Invalid/Timezone' } }),
    withSettings({ display_schedule: { ...schedule, pages: [] } }),
    withSettings({ display_schedule: { ...schedule, pages: Array(13).fill(schedule.pages[0]) } }),
    withSettings({ display_schedule: { ...schedule, pages: [schedule.pages[0], schedule.pages[0]] } }),
    withSettings({ display_schedule: { ...schedule, pages: [{ ...schedule.pages[0], duration_seconds: 10 }] } }),
    withSettings({ display_schedule: { ...schedule, pages: [{ ...schedule.pages[0], id: 'private/url' }] } }),
    withSettings({ display_schedule: { ...schedule, quiet_hours: { enabled: true, start: '22:00', end: '22:00' } } }),
    withSettings({ display_schedule: { ...schedule, quiet_hours: { enabled: true, start: '24:00', end: '07:00' } } }),
    withSettings({ display_schedule: { ...schedule, private_url: 'https://private' } }),
    withSettings({ weather_location: 'a'.repeat(8193) }),
  ])('rejects incompatible, unbounded or private template data %j', (input) => {
    expect(() => parseDisplayTemplate(input)).toThrow();
  });
});

describe('authenticated template endpoints', () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use('/templates', templatesRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/templates`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  function request(path: string, body?: unknown, authenticated = true) {
    return fetch(`${baseUrl}/${path}`, {
      method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer token' } : {}) },
    });
  }

  it('exports only the authenticated account settings', async () => {
    const response = await request('export');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(template);
    expect(getOrCreateUserFromClerk).toHaveBeenCalledWith('clerk-owner');
    expect(getPreferences).toHaveBeenCalledWith('owner');
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it('validates the review without any database writes', async () => {
    const response = await request('validate', template);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ template });
    expect(getOrCreateUserFromClerk).not.toHaveBeenCalled();
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it('applies every reviewed setting in one preferences operation', async () => {
    const response = await request('import', template);
    expect(response.status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledTimes(1);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', template.settings);
  });

  it('revalidates imports and does not save any partial fields from an invalid document', async () => {
    const response = await request('import', withSettings({ show_weather: false, refresh_interval_minutes: -1 }));
    expect(response.status).toBe(400);
    expect(getOrCreateUserFromClerk).not.toHaveBeenCalled();
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it('rejects over-sized documents without saving', async () => {
    const response = await request('import', withSettings({ weather_location: 'x'.repeat(33000) }));
    expect(response.status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it.each(['export', 'starters', 'validate', 'import'])('requires authentication for %s', async (path) => {
    const response = await request(path, ['validate', 'import'].includes(path) ? template : undefined, false);
    expect(response.status).toBe(401);
    expect(getPreferences).not.toHaveBeenCalled();
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
});
