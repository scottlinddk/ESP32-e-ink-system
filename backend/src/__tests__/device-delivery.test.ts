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
import { recordHeartbeat, tokenHash, validateHeartbeat } from '../services/deviceDelivery';
import { errorHandler } from '../middleware/errorHandler';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { logger } from '../lib/logger';
import { DATABASE_FAILURE_HINTS } from '../services/databaseHealth';
// @ts-expect-error The standalone reference client is deliberately dependency-free JavaScript.
import { createPoller } from '../../../tools/display-client.mjs';

const state = vi.hoisted(() => ({ deliveries: new Map<string, Record<string, unknown>>(), owners: new Map([['device-a', 'owner-a'], ['device-b', 'owner-b']]),
  schemaError: null as string | null, storageError: null as string | null,
}));
vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const owner = req.headers.authorization?.replace('Bearer ', '');
  if (owner !== 'owner-a' && owner !== 'owner-b') { res.status(401).json({ error: 'Unauthorized' }); return; }
  req.clerkUserId = owner; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: async (id: string) => id }));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/displayData', async (original) => ({ ...await original<typeof import('../services/displayData')>(), buildDisplayData: vi.fn() }));
vi.mock('../services/database', () => ({ getApiKeys: vi.fn(), getPreferences: vi.fn(), getSupabaseClient: () => ({ from: (table: string) => {
  const filters: Array<[string, unknown]> = []; let operation = ''; let update: Record<string, unknown> = {}; let selected = '*';
  const rows = () => table === 'devices' ? [...state.owners].map(([id, user_id]) => ({ id, user_id })) : table === 'device_delivery' ? [...state.deliveries.values()] : [];
  const matches = () => rows().filter((row) => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value));
  const execute = async () => {
    if (table === 'device_delivery' && state.storageError) return { data: null, error: { code: state.storageError, message: 'Database unavailable' } };
    if (table === 'device_delivery' && state.schemaError && (selected.includes('refresh_') || Object.keys(update).some((key) => key.startsWith('refresh_')))) {
      return { data: null, error: { code: state.schemaError, message: 'Column refresh_request_id is missing' } };
    }
    if (operation === 'upsert') state.deliveries.set(String(update.device_id), { ...state.deliveries.get(String(update.device_id)), ...update });
    if (operation === 'update') for (const row of matches()) Object.assign(row, update);
    const row = matches()[0]; return { data: row ? structuredClone(row) : null, error: null };
  };
  const query = {
    select: (columns = '*') => { selected = columns; return query; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    maybeSingle: execute,
    upsert: (value: Record<string, unknown>) => { operation = 'upsert'; update = value; return query; },
    update: (value: Record<string, unknown>) => { operation = 'update'; update = value; return query; },
    then: (resolve: (result: Awaited<ReturnType<typeof execute>>) => unknown) => execute().then(resolve),
  };
  return query;
} }) }));

describe('authenticated device delivery', () => {
  let server: Server; let base: string;
  const ownerHeaders = { Authorization: 'Bearer owner-a', 'Content-Type': 'application/json' };
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/devices', managementRouter); app.use('/device-feed', feedRouter); app.use(errorHandler);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    state.deliveries.clear(); vi.clearAllMocks(); state.schemaError = null; state.storageError = null;
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
  const refresh = (id = 'device-a') => fetch(`${base}/devices/${id}/refresh`, { method: 'POST', headers: ownerHeaders });
  const status = () => fetch(`${base}/devices/device-a/delivery`, { headers: ownerHeaders }).then((response) => response.json());
  const heartbeat = (token: string, fields: Record<string, unknown> = {}) => fetch(`${base}/device-feed/device-a/heartbeat`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ firmware_version: 'test/1.2', ...fields }),
  });

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
  it('logs a safe gateway reason when frame preferences receive an HTML proxy error', async () => {
    const token = await create();
    vi.mocked(getPreferences).mockRejectedValueOnce({ message: `<html><title>404 Not Found</title><body>private upstream detail ${token}</body></html>` });
    const response = await frame(token);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({ error: 'Unable to render display frame' });
    expect(logger.error).toHaveBeenCalledWith(
      { reason: 'gateway_error', hint: DATABASE_FAILURE_HINTS.gateway_error }, 'Device frame request failed');
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toMatch(/private upstream detail|<html>|einkd_/);
    expect((await heartbeat(token)).status).toBe(200);
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
  it('queues only for the authenticated owner with an active token and exposes no credential', async () => {
    expect((await refresh()).status).toBe(409);
    expect((await refresh('device-b')).status).toBe(404);
    expect((await fetch(`${base}/devices/device-a/refresh`, { method: 'POST' })).status).toBe(401);
    const token = await create(); const response = await refresh();
    expect(response.status).toBe(202); expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text(); const queued = JSON.parse(text);
    expect(queued).toMatchObject({ configured: true, refreshRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/), refreshRequestedAt: expect.any(String), refreshAppliedAt: null });
    expect(text).not.toContain(token); expect(text).not.toContain(tokenHash(token));
    expect(await status()).toEqual(queued);
    await fetch(`${base}/devices/device-a/delivery/token`, { method: 'DELETE', headers: ownerHeaders });
    expect((await refresh()).status).toBe(409);
  });

  it('forces unchanged bytes, retries a lost ACK, then retains the matching application history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const token = await create(); const initial = await frame(token);
    const bytes = Buffer.from(await initial.arrayBuffer()); const etag = initial.headers.get('etag')!;
    await refresh(); const id = state.deliveries.get('device-a')!.refresh_request_id as string;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Explicit cache header prevents fetch from adding no-cache automatically;
      // embedded clients send validators without a forced browser reload.
      const forced = await frame(token, { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' });
      expect(forced.status).toBe(200); expect(forced.headers.get('x-refresh-request-id')).toBe(id);
      expect(Buffer.from(await forced.arrayBuffer())).toEqual(bytes);
    }
    // A legacy heartbeat or failed panel application cannot acknowledge a command.
    await heartbeat(token, { last_applied_hash: initial.headers.get('x-image-sha256') });
    await heartbeat(token, { last_applied_hash: null });
    expect(await status()).toMatchObject({ refreshRequestId: id, refreshAppliedAt: null });
    vi.setSystemTime(new Date('2026-10-02T12:01:00Z'));
    const ack = { refresh_request_id: id, last_applied_hash: initial.headers.get('x-image-sha256') };
    expect((await heartbeat(token, ack)).status).toBe(200);
    expect(await status()).toMatchObject({ refreshRequestId: id, refreshRequestedAt: '2026-10-02T12:00:00.000Z', refreshAppliedAt: '2026-10-02T12:01:00.000Z' });
    vi.setSystemTime(new Date('2026-10-02T12:02:00Z'));
    expect((await heartbeat(token, ack)).status).toBe(200);
    expect(await status()).toMatchObject({ refreshAppliedAt: '2026-10-02T12:01:00.000Z' });
    const unchanged = await frame(token, { 'If-None-Match': etag });
    expect(unchanged.status).toBe(304); expect(unchanged.headers.get('x-refresh-request-id')).toBeNull();
  });

  it('pins the pending request before source work and prevents an old ACK consuming a newer click', async () => {
    const token = await create(); await refresh();
    const first = state.deliveries.get('device-a')!.refresh_request_id as string;
    vi.mocked(buildDisplayData).mockImplementationOnce(async () => {
      expect((await refresh()).status).toBe(202);
      return { nextRefresh: 120000, news: [{ title: 'Live frame', url: '' }] };
    });
    const response = await frame(token); const second = state.deliveries.get('device-a')!.refresh_request_id as string;
    expect(first).not.toBe(second); expect(response.headers.get('x-refresh-request-id')).toBe(first);
    await heartbeat(token, { refresh_request_id: first, last_applied_hash: response.headers.get('x-image-sha256') });
    expect(await status()).toMatchObject({ refreshRequestId: second, refreshAppliedAt: null });
    expect((await frame(token)).headers.get('x-refresh-request-id')).toBe(second);
  });

  it('does not attach a request created during collection to a frame that started without one', async () => {
    const token = await create();
    vi.mocked(buildDisplayData).mockImplementationOnce(async () => {
      await refresh(); return { nextRefresh: 120000, news: [{ title: 'Live frame', url: '' }] };
    });
    const response = await frame(token);
    expect(response.headers.get('x-refresh-request-id')).toBeNull();
    expect((await frame(token)).headers.get('x-refresh-request-id')).toBe(state.deliveries.get('device-a')!.refresh_request_id);
  });

  it('allows an explicit refresh in quiet hours and returns to quiet after the ACK', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T23:00:00Z'));
    const token = await create();
    const layout = { version: 1 as const, cols: 10 as const, rows: 6 as const, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6 }] };
    vi.mocked(getPreferences).mockResolvedValue({ ...DEFAULT_PREFS, display_schedule: { enabled: true, timezone: 'UTC', pages: [{ id: 'page', name: 'Page', duration_seconds: 60, layout }], quiet_hours: { enabled: true, start: '22:00', end: '06:00' } } });
    expect((await frame(token)).status).toBe(204);
    await refresh(); const forced = await frame(token);
    expect(forced.status).toBe(200); expect(buildDisplayData).toHaveBeenCalledTimes(1);
    await heartbeat(token, { refresh_request_id: forced.headers.get('x-refresh-request-id'), last_applied_hash: forced.headers.get('x-image-sha256') });
    expect((await frame(token)).status).toBe(204);
  });

  it('resets refresh state on rotation and rejects in-flight reports from the old token or owner', async () => {
    const oldToken = await create(); await refresh();
    const oldId = state.deliveries.get('device-a')!.refresh_request_id as string;
    const newToken = await create();
    expect(await status()).toMatchObject({ refreshRequestId: null, refreshRequestedAt: null, refreshAppliedAt: null });
    await refresh(); const pending = state.deliveries.get('device-a')!.refresh_request_id;
    await recordHeartbeat('owner-a', 'device-a', tokenHash(oldToken), { firmware_version: 'old', last_applied_hash: 'ab'.repeat(32), refresh_request_id: oldId });
    expect(await status()).toMatchObject({ firmwareVersion: null, refreshRequestId: pending, refreshAppliedAt: null });
    state.owners.set('device-a', 'owner-b');
    state.deliveries.get('device-a')!.owner_id = 'owner-b';
    await recordHeartbeat('owner-a', 'device-a', tokenHash(newToken), { firmware_version: 'old-owner', last_applied_hash: 'ab'.repeat(32), refresh_request_id: pending as string });
    expect(state.deliveries.get('device-a')).toMatchObject({ firmware_version: null, refresh_applied_at: null });
  });

  it.each(['42703', 'PGRST204'])('preserves legacy tokens, frames and heartbeats before migration019 (%s)', async (code) => {
    state.schemaError = code;
    const token = await create(); expect((await frame(token)).status).toBe(200);
    expect((await heartbeat(token, { last_applied_hash: null })).status).toBe(200);
    expect(await status()).toMatchObject({ configured: true, refreshRequestId: null, refreshRequestedAt: null, refreshAppliedAt: null });
    const rejected = await refresh(); expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('019') });
    expect((await fetch(`${base}/devices/device-a/delivery/token`, { method: 'DELETE', headers: ownerHeaders })).status).toBe(200);
  });

  it('does not hide permission/storage errors as an old schema', async () => {
    const token = await create(); state.schemaError = '42501';
    expect((await frame(token)).status).toBe(503);
    expect((await refresh()).status).toBe(500);
    expect((await fetch(`${base}/devices/device-a/delivery/token`, { method: 'POST', headers: ownerHeaders })).status).toBe(500);
  });

  it.each([
    { refresh_request_id: null, last_applied_hash: 'ab'.repeat(32) },
    { refresh_request_id: 'bad', last_applied_hash: 'ab'.repeat(32) },
    { refresh_request_id: '11111111-1111-4111-8111-111111111111' },
    { refresh_request_id: '11111111-1111-4111-8111-111111111111', last_applied_hash: null },
    { refresh_request_id: '11111111-1111-4111-8111-111111111111', last_applied_hash: 'bad' },
  ])('requires a valid applied hash and request UUID for an ACK: %j', async (fields) => {
    const token = await create(); await refresh();
    expect((await heartbeat(token, fields)).status).toBe(400);
    expect(state.deliveries.get('device-a')?.refresh_applied_at).toBeNull();
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
