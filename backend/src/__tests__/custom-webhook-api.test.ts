import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { verifyToken } from '@clerk/backend';
import webhookRouter from '../routes/custom-webhook';
import imageRouter from '../routes/image';
import displayDataRouter from '../routes/display-data';
import preferencesRouter from '../routes/preferences';
import { DEFAULT_PREFS } from '../services/displayData';
import { hashWebhookToken, WebhookRecord } from '../services/customWebhook';
import { errorHandler } from '../middleware/errorHandler';
import type { DisplayData, UserPreferences } from '../types';

const state = vi.hoisted(() => ({
  records: new Map<string, WebhookRecord>(), preferences: new Map<string, UserPreferences>(),
  writes: [] as Array<{ filters: Array<[string, unknown]>; data: unknown }>, revokeOnWrite: false,
}));

// A minimal in-memory PostgREST query double preserves equality filters so these
// tests exercise the service's actual owner/hash filtering and token storage.
class Query {
  private operation = 'select';
  private payload: Record<string, unknown> = {};
  private filters: Array<[string, unknown]> = [];
  select(_fields?: string) { return this; }
  eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
  abortSignal(_signal: AbortSignal) { return this; }
  upsert(payload: Record<string, unknown>) { this.operation = 'upsert'; this.payload = payload; return this; }
  update(payload: Record<string, unknown>) { this.operation = 'update'; this.payload = payload; return this; }
  async maybeSingle() { return this.run(); }
  then(resolve: (value: ReturnType<Query['run']>) => unknown, reject?: (error: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
  private run() {
    if (this.operation === 'upsert') {
      state.records.set(String(this.payload.user_id), structuredClone(this.payload) as unknown as WebhookRecord);
      state.writes.push({ filters: this.filters, data: this.payload });
      return { data: this.payload, error: null };
    }
    if (this.operation === 'update' && state.revokeOnWrite) {
      state.revokeOnWrite = false;
      for (const record of state.records.values()) record.token_hash = null;
    }
    const matches = [...state.records.values()].filter((row) => this.filters.every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value));
    if (this.operation === 'update') {
      state.writes.push({ filters: this.filters, data: this.payload });
      for (const row of matches) Object.assign(row, this.payload);
    }
    return { data: matches[0] ?? null, error: null };
  }
}

vi.mock('../services/database', () => ({
  getSupabaseClient: vi.fn(() => ({ from: vi.fn(() => new Query()) })),
  getPreferences: vi.fn(async (userId: string) => state.preferences.get(userId) ?? null),
  upsertPreferences: vi.fn(async (userId: string, updates: Partial<UserPreferences>) => {
    const next = { ...state.preferences.get(userId), ...updates } as UserPreferences;
    state.preferences.set(userId, next); return next;
  }),
  getApiKeys: vi.fn().mockResolvedValue([]),
  upsertUser: vi.fn(async (email: string) => ({ id: email.split('@')[0] })),
  logApiUsage: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn(),
}));
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({ users: { getUser: vi.fn(async (id: string) => ({ emailAddresses: [{ emailAddress: `${id}@example.com` }] })) } })),
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

describe('custom webhook authentication and persisted snapshots', () => {
  let server: Server;
  let baseUrl: string;
  const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const send = (path: string, token: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}${path}`, {
    method, headers: headers(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function issue(owner = 'alice'): Promise<string> {
    const response = await send('/custom-webhook/token', owner, 'POST', {});
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return ((await response.json()) as { token: string }).token;
  }
  const reading = { rows: [{ label: 'Kitchen', value: '21.5', unit: '°C' }] };

  beforeAll(async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
    const app = express();
    app.use(express.json({ limit: '10kb' }));
    app.use('/custom-webhook', webhookRouter);
    app.use('/image', imageRouter);
    app.use('/preview', displayDataRouter);
    app.use('/preferences', preferencesRouter);
    app.use(errorHandler);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    state.records.clear(); state.preferences.clear(); state.writes = []; state.revokeOnWrite = false;
    for (const owner of ['alice', 'bob']) state.preferences.set(owner, {
      ...DEFAULT_PREFS, show_energy_price: false, show_news: false, show_weather: false, show_custom_webhook: true,
      custom_webhook_ttl_minutes: 30,
      layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'custom-webhook', x: 0, y: 0, w: 10, h: 3 }] },
    });
    vi.mocked(verifyToken).mockImplementation(async (token) => {
      if (!['alice', 'bob'].includes(token)) throw new Error('Invalid Clerk token');
      return { sub: token } as Awaited<ReturnType<typeof verifyToken>>;
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('stores only token hashes, returns plaintext once, and excludes secrets from status', async () => {
    const token = await issue();
    expect(token).toMatch(/^ewh_[a-f0-9]{64}$/);
    expect(state.records.get('alice')?.token_hash).toBe(hashWebhookToken(token));
    expect(JSON.stringify(state.writes)).not.toContain(token);
    const response = await send('/custom-webhook', 'alice');
    const status = await response.json();
    expect(status).toMatchObject({ configured: true, state: 'unavailable', rowCount: 0 });
    expect(JSON.stringify(status)).not.toContain(token);
    expect(JSON.stringify(status)).not.toContain(hashWebhookToken(token));
  });

  it('isolates two owners for ingestion, rendering, settings and revocation', async () => {
    const aliceToken = await issue('alice'); const bobToken = await issue('bob');
    const calls = vi.mocked(verifyToken).mock.calls.length;
    expect((await send('/custom-webhook/ingest', aliceToken, 'POST', reading)).status).toBe(200);
    expect(verifyToken).toHaveBeenCalledTimes(calls); // The ingestion route does not use Clerk.
    expect(state.records.get('bob')?.rows).toEqual([]);
    const alice = await (await send('/preview', 'alice')).json() as DisplayData;
    const bob = await (await send('/preview', 'bob')).json() as DisplayData;
    expect(alice.customWebhook?.rows).toEqual(reading.rows);
    expect(bob.customWebhook?.state).toBe('unavailable');
    const bmp = Buffer.from(await (await send('/image/preview', 'alice')).arrayBuffer());
    const raw = Buffer.from(await (await send('/image/preview/raw', 'alice')).arrayBuffer());
    expect(bmp.subarray(62)).toEqual(raw);
    expect((await send('/custom-webhook/token', 'alice', 'DELETE')).status).toBe(204);
    expect((await send('/custom-webhook/ingest', aliceToken, 'POST', reading)).status).toBe(401);
    expect((await send('/custom-webhook/ingest', bobToken, 'POST', reading)).status).toBe(200);
    expect(state.records.get('alice')?.rows).toEqual([]);
  });

  it('invalidates replaced tokens and rechecks revocation atomically at write time', async () => {
    const oldToken = await issue(); const currentToken = await issue();
    expect(currentToken).not.toBe(oldToken);
    expect((await send('/custom-webhook/ingest', oldToken, 'POST', reading)).status).toBe(401);
    state.revokeOnWrite = true;
    expect((await send('/custom-webhook/ingest', currentToken, 'POST', reading)).status).toBe(401);
    expect(state.records.get('alice')?.rows).toEqual([]);
    expect(state.writes.at(-1)?.filters).toEqual([['user_id', 'alice'], ['token_hash', hashWebhookToken(currentToken)]]);
  });

  it('rejects wrong auth, malformed/oversized payloads and cross-owner fields', async () => {
    const token = await issue();
    expect((await send('/custom-webhook/ingest', 'alice', 'POST', reading)).status).toBe(401);
    expect((await send('/custom-webhook/ingest', `ewh_${'0'.repeat(64)}`, 'POST', reading)).status).toBe(401);
    expect((await send('/custom-webhook/token', token, 'POST', {})).status).toBe(401);
    for (const payload of [{ rows: [] }, { ...reading, user_id: 'bob' }, { ...reading, observed_at: '2026-09-29T12:00:00Z' }]) {
      expect((await send('/custom-webhook/ingest', token, 'POST', payload)).status).toBe(400);
    }
    expect((await send('/custom-webhook/ingest', token, 'POST', { rows: [{ label: 'x', value: 'x'.repeat(11000) }] })).status).toBe(413);
    expect(state.records.get('alice')?.rows).toEqual([]);
  });

  it('reports expiry on both status and display, while disabling the widget keeps its data private', async () => {
    const token = await issue();
    await send('/custom-webhook/ingest', token, 'POST', { ...reading, observed_at: '2026-09-28T11:30:01Z' });
    expect(await (await send('/custom-webhook', 'alice')).json()).toMatchObject({ state: 'fresh' });
    vi.setSystemTime(new Date('2026-09-28T12:00:01Z'));
    expect(await (await send('/custom-webhook', 'alice')).json()).toMatchObject({ state: 'stale' });
    expect(await (await send('/preview', 'alice')).json()).toMatchObject({ customWebhook: { state: 'stale' } });
    expect((await send('/preferences', 'alice', 'POST', { show_custom_webhook: false })).status).toBe(200);
    expect(await (await send('/preview', 'alice')).json()).not.toHaveProperty('customWebhook');
    expect(state.records.get('alice')?.rows).toEqual(reading.rows);
    expect((await send('/preferences', 'alice', 'POST', { custom_webhook_ttl_minutes: 0 })).status).toBe(400);
    expect(state.preferences.get('bob')?.show_custom_webhook).toBe(true);
  });
});
