import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { getApiKeys, getPreferences, getUserByEmail, upsertPreferences, upsertUser } from '../services/database';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import imageRouter from '../routes/image';
import { parseDisplayLayout } from '../utils/layoutValidation';
import type { DisplayLayout, User } from '../types';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn(), createClerkClient: vi.fn() }));
vi.mock('../services/database', () => ({
  getPreferences: vi.fn(), getApiKeys: vi.fn(), getUserByEmail: vi.fn(), upsertUser: vi.fn(), upsertPreferences: vi.fn(),
}));
vi.mock('../services/displayData', async (original) => ({
  ...await original<typeof import('../services/displayData')>(), buildDisplayData: vi.fn(),
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 10, h: 2 }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
  vi.mocked(verifyToken).mockResolvedValue({ sub: 'clerk-owner' } as Awaited<ReturnType<typeof verifyToken>>);
  vi.mocked(createClerkClient).mockReturnValue({ users: { getUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: 'owner@example.com' }] }) } } as unknown as ReturnType<typeof createClerkClient>);
  vi.mocked(getUserByEmail).mockResolvedValue({ id: 'owner' } as User);
  vi.mocked(upsertUser).mockResolvedValue({ id: 'owner' } as User);
  vi.mocked(getPreferences).mockResolvedValue({ ...DEFAULT_PREFS, layout });
  vi.mocked(getApiKeys).mockResolvedValue([]);
  vi.mocked(buildDisplayData).mockResolvedValue({ nextRefresh: 1800000, price: { now: 25, average: 50, trend: 'down' } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('draft layout validation', () => {
  it('accepts empty and edge-aligned layouts and returns a copy', () => {
    expect(parseDisplayLayout({ ...layout, widgets: [] }).widgets).toEqual([]);
    expect(parseDisplayLayout(layout)).toEqual(layout);
    expect(parseDisplayLayout(layout).widgets[0]).not.toBe(layout.widgets[0]);
    expect(parseDisplayLayout({ ...layout, widgets: [{ i: 'status', x: 0, y: 5, w: 10, h: 1, static: true }] }).widgets).toHaveLength(1);
  });

  it.each([
    null, [], {}, { ...layout, version: 2 }, { ...layout, cols: 20 }, { ...layout, rows: 0 },
    { ...layout, widgets: null }, { ...layout, widgets: Array(8).fill(layout.widgets[0]) },
    ...[{ i: 'unknown' }, { x: -1 }, { x: 1.1 }, { x: '0' }, { x: Infinity }, { w: 11 }, { w: 0 }, { h: -1 }, { y: 5 }, { static: 'yes' }]
      .map((change) => ({ ...layout, widgets: [{ ...layout.widgets[0], ...change }] })),
    { ...layout, widgets: [layout.widgets[0], layout.widgets[0]] },
    { ...layout, widgets: [layout.widgets[0], { i: 'weather', x: 5, y: 1, w: 5, h: 2 }] },
  ])('rejects malformed or unsafe layout %j', (input) => {
    expect(() => parseDisplayLayout(input)).toThrow();
  });
});

describe('authenticated draft image endpoint', () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/image', imageRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  function draft(body: unknown = { layout }, authenticated = true) {
    return fetch(`${baseUrl}/image/preview/draft`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-token' } : {}) },
    });
  }

  it('renders the same pixels as a saved layout without any database writes', async () => {
    const response = await draft();
    const pixels = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/bmp');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upsertUser).not.toHaveBeenCalled();
    expect(upsertPreferences).not.toHaveBeenCalled();
    expect(getUserByEmail).toHaveBeenCalledWith('owner@example.com');
    expect(getPreferences).toHaveBeenCalledWith('owner');
    expect(getApiKeys).toHaveBeenCalledWith('owner');
    expect(buildDisplayData).toHaveBeenCalledWith('owner', { ...DEFAULT_PREFS, layout }, {});
    const saved = await fetch(`${baseUrl}/image/preview`, { headers: { Authorization: 'Bearer test-token' } });
    expect(pixels).toEqual(Buffer.from(await saved.arrayBuffer()));
  });

  it('renders submitted positions rather than the persisted layout', async () => {
    const initial = await draft();
    const moved = await draft({ layout: { ...layout, widgets: [{ ...layout.widgets[0], y: 3 }] } });
    expect(Buffer.from(await initial.arrayBuffer())).not.toEqual(Buffer.from(await moved.arrayBuffer()));
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it.each([{}, { layout: null }, { layout: { ...layout, widgets: [{ i: 'energy', x: 0, y: 0, w: 1000000, h: 1 }] } }, { layout, user_id: 'victim' }, { layout, api_keys: { openweathermap: 'injected' } }])('rejects invalid drafts before looking up private data', async (body) => {
    const response = await draft(body);
    expect(response.status).toBe(400);
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(getPreferences).not.toHaveBeenCalled();
    expect(getApiKeys).not.toHaveBeenCalled();
    expect(buildDisplayData).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    expect((await draft({ layout }, false)).status).toBe(401);
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('does not create a missing user during a draft request', async () => {
    vi.mocked(getUserByEmail).mockResolvedValue(null);
    expect((await draft()).status).toBe(404);
    expect(upsertUser).not.toHaveBeenCalled();
    expect(getPreferences).not.toHaveBeenCalled();
  });

  it('selects data using the verified account rather than a previous account', async () => {
    vi.mocked(createClerkClient).mockReturnValue({ users: { getUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: 'second@example.com' }] }) } } as unknown as ReturnType<typeof createClerkClient>);
    vi.mocked(getUserByEmail).mockResolvedValue({ id: 'second-owner' } as User);
    expect((await draft()).status).toBe(200);
    expect(getUserByEmail).toHaveBeenCalledWith('second@example.com');
    expect(getApiKeys).toHaveBeenCalledWith('second-owner');
    expect(getPreferences).toHaveBeenCalledWith('second-owner');
  });
});
