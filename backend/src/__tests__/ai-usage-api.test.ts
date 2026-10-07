import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { verifyToken } from '@clerk/backend';
import aiUsageRouter from '../routes/ai-usage';
import displayDataRouter from '../routes/display-data';
import { DEFAULT_PREFS } from '../services/displayData';
import { hashAiUsageToken, type AiUsageRecord } from '../aiUsage/store';
import { clearAiUsageCache } from '../aiUsage';
import { errorHandler } from '../middleware/errorHandler';
import type { DisplayData, UserPreferences } from '../types';

const state = vi.hoisted(() => ({
  records: new Map<string, AiUsageRecord>(), preferences: new Map<string, UserPreferences>(),
  keys: new Map<string, Array<{ id: string; provider: string; api_key: string; created_at: string }>>(),
  writes: [] as unknown[],
}));

// In-memory PostgREST double that honours equality filters, so the tests exercise the
// store's owner and token-hash filtering.
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
    state.writes.push(this.payload);
    if (this.operation === 'upsert') {
      state.records.set(String(this.payload.user_id), structuredClone(this.payload) as unknown as AiUsageRecord);
      return { data: this.payload, error: null };
    }
    const matches = [...state.records.values()].filter((row) => this.filters.every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value));
    if (this.operation === 'update') for (const row of matches) Object.assign(row, structuredClone(this.payload));
    return { data: matches[0] ? structuredClone(matches[0]) : null, error: null };
  }
}

vi.mock('../services/database', () => ({
  getSupabaseClient: vi.fn(() => ({ from: vi.fn(() => new Query()) })),
  getPreferences: vi.fn(async (userId: string) => state.preferences.get(userId) ?? null),
  getApiKeys: vi.fn(async (userId: string) => state.keys.get(userId) ?? []),
  upsertApiKey: vi.fn(async (userId: string, provider: string, apiKey: string) => {
    const keys = (state.keys.get(userId) ?? []).filter((key) => key.provider !== provider);
    const row = { id: provider, provider, api_key: apiKey, created_at: '2026-10-07T00:00:00Z' };
    state.keys.set(userId, [...keys, row]);
    return row;
  }),
  deleteApiKey: vi.fn(async (userId: string, provider: string) => {
    state.keys.set(userId, (state.keys.get(userId) ?? []).filter((key) => key.provider !== provider));
  }),
  upsertUser: vi.fn(async (email: string) => ({ id: email.split('@')[0] })),
  getUserByEmail: vi.fn(async (email: string) => ({ id: email.split('@')[0] })),
  logApiUsage: vi.fn(),
}));
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({ users: { getUser: vi.fn(async (id: string) => ({ emailAddresses: [{ emailAddress: `${id}@example.com` }] })) } })),
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const snapshot = {
  machine: 'laptop',
  providers: {
    claude: {
      limits: { observed_at: '2026-10-07T09:58:00Z', windows: [{ window_minutes: 300, used_percent: 58, resets_at: '2026-10-07T12:00:00Z' }] },
      usage: { day: '2026-10-07', models: [{ model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_write_tokens: 0, cache_read_tokens: 0 }] },
    },
  },
};

describe('AI usage integration API', () => {
  let server: Server;
  let baseUrl: string;
  const send = (path: string, token: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function issue(owner = 'alice'): Promise<string> {
    const response = await send('/ai-usage/token', owner, 'POST', {});
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  }

  beforeAll(async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
    const app = express();
    app.use(express.json({ limit: '10kb' }));
    app.use('/ai-usage', aiUsageRouter);
    app.use('/preview', displayDataRouter);
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
    clearAiUsageCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    state.records.clear(); state.preferences.clear(); state.keys.clear(); state.writes = [];
    for (const owner of ['alice', 'bob']) state.preferences.set(owner, {
      ...DEFAULT_PREFS, show_energy_price: false, show_news: false, show_weather: false, show_ai_usage: true, display_timezone: 'Europe/Copenhagen',
      layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'ai-usage', x: 0, y: 0, w: 10, h: 6 }] },
    });
    vi.mocked(verifyToken).mockImplementation(async (token) => {
      if (!['alice', 'bob'].includes(token)) throw new Error('Invalid Clerk token');
      return { sub: token } as Awaited<ReturnType<typeof verifyToken>>;
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('stores only the token hash and accepts a push for the owner only', async () => {
    const token = await issue();
    expect(token).toMatch(/^eau_[a-f0-9]{64}$/);
    expect(state.records.get('alice')?.token_hash).toBe(hashAiUsageToken(token));
    expect(JSON.stringify(state.writes)).not.toContain(token);

    const pushed = await send('/ai-usage/ingest', token, 'POST', snapshot);
    expect(pushed.status).toBe(200);
    expect(await pushed.json()).toEqual({ machine: 'laptop', providers: ['claude'] });

    const alice = await (await send('/preview', 'alice')).json() as DisplayData;
    expect(alice.aiUsage?.providers[0]).toMatchObject({ provider: 'claude', limits: [{ label: '5h', usedPercent: 58 }], today: { tokens: 1500 } });
    const bob = await (await send('/preview', 'bob')).json() as DisplayData;
    expect(bob.aiUsage).toEqual({ providers: [] });

    const status = await (await send('/ai-usage', 'alice')).json();
    expect(status).toMatchObject({ configured: true, reports: { claude: { limitsObservedAt: '2026-10-07T09:58:00.000Z', machines: [{ name: 'laptop', day: '2026-10-07' }] } }, adminKeys: { claude: false, openai: false } });
    expect(JSON.stringify(status)).not.toContain(hashAiUsageToken(token));
  });

  it('rejects sign-in tokens, malformed tokens, revoked tokens and invalid payloads', async () => {
    expect((await send('/ai-usage/ingest', 'alice', 'POST', snapshot)).status).toBe(401);
    expect((await send('/ai-usage/ingest', `eau_${'0'.repeat(64)}`, 'POST', snapshot)).status).toBe(401);
    const token = await issue();
    const invalid = await send('/ai-usage/ingest', token, 'POST', { ...snapshot, prompt: 'hello' });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toContain('does not accept');
    expect((await send('/ai-usage/token', 'alice', 'DELETE')).status).toBe(204);
    expect((await send('/ai-usage/ingest', token, 'POST', snapshot)).status).toBe(401);
    expect(state.records.get('alice')?.providers).toEqual({});
  });

  it('replacing the token clears the previous snapshot and stops the old collector', async () => {
    const first = await issue();
    await send('/ai-usage/ingest', first, 'POST', snapshot);
    const second = await issue();
    expect(state.records.get('alice')?.providers).toEqual({});
    expect((await send('/ai-usage/ingest', first, 'POST', snapshot)).status).toBe(401);
    expect((await send('/ai-usage/ingest', second, 'POST', snapshot)).status).toBe(200);
  });

  it('accepts only admin keys, stores them through the encrypted key store, and tests without leaking them', async () => {
    const regular = await send('/ai-usage/admin-keys/claude', 'alice', 'PUT', { api_key: `sk-ant-api03-${'x'.repeat(40)}` });
    expect(regular.status).toBe(400);
    expect(((await regular.json()) as { error: string }).error).toContain('sk-ant-admin');
    expect((await send('/ai-usage/admin-keys/gemini', 'alice', 'PUT', { api_key: 'x' })).status).toBe(400);

    const key = `sk-admin-${'k'.repeat(40)}`;
    expect((await send('/ai-usage/admin-keys/openai', 'alice', 'PUT', { api_key: key })).status).toBe(200);
    expect(state.keys.get('alice')?.map((entry) => entry.provider)).toEqual(['openai_admin']);

    const fetchMock = vi.fn(async (url: URL) => new Response(JSON.stringify(url.pathname.endsWith('/costs')
      ? { data: [{ results: [{ amount: { value: 3.5, currency: 'usd' } }] }], has_more: false }
      : { data: [{ results: [{ model: 'gpt-6-sol', input_tokens: 100, output_tokens: 10 }] }], has_more: false }), { status: 200 }));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
      input instanceof URL && input.hostname === 'api.openai.com' ? fetchMock(input) : realFetch(input, init));
    const tested = await send('/ai-usage/test', 'alice', 'POST', {});
    const body = await tested.json() as { aiUsage: DisplayData['aiUsage'] };
    expect(body.aiUsage?.providers[0]).toMatchObject({ provider: 'openai', monthCostUsd: 3.5, today: { tokens: 110 } });
    expect(JSON.stringify(body)).not.toContain(key);
    const status = await (await send('/ai-usage', 'alice')).json() as { adminKeys: unknown };
    expect(status.adminKeys).toEqual({ claude: false, openai: true });

    expect((await send('/ai-usage/admin-keys/openai', 'alice', 'DELETE')).status).toBe(204);
    expect(state.keys.get('alice')).toEqual([]);
  });
});
