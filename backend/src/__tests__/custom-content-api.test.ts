import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { verifyToken } from '@clerk/backend';
import { upsertPreferences } from '../services/database';
import { DEFAULT_PREFS } from '../services/displayData';
import preferencesRouter from '../routes/preferences';
import displayDataRouter from '../routes/display-data';
import imageRouter from '../routes/image';
import { errorHandler } from '../middleware/errorHandler';
import type { DisplayData, UserPreferences } from '../types';

const state = vi.hoisted(() => ({ preferences: {} as UserPreferences }));
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({ users: { getUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: 'owner@example.com' }] }) } })),
}));
vi.mock('../services/database', () => ({
  getApiKeys: vi.fn().mockResolvedValue([]),
  getPreferences: vi.fn(async () => state.preferences),
  upsertPreferences: vi.fn(async (_userId: string, updates: Partial<UserPreferences>) => {
    state.preferences = { ...state.preferences, ...updates };
    return state.preferences;
  }),
  upsertUser: vi.fn().mockResolvedValue({ id: 'owner-id' }),
  logApiUsage: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn(),
}));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

describe('custom content persistence and display API', () => {
  let server: Server;
  let baseUrl: string;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const post = (body: unknown) => fetch(`${baseUrl}/preferences`, { method: 'POST', headers, body: JSON.stringify(body) });

  beforeAll(async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
    const app = express();
    app.use('/preferences', express.json({ limit: '64kb' }), preferencesRouter);
    app.use('/preview', displayDataRouter);
    app.use('/image', imageRouter);
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
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'owner-clerk' } as Awaited<ReturnType<typeof verifyToken>>);
    state.preferences = { ...DEFAULT_PREFS, show_energy_price: false, show_weather: false, show_news: false };
  });

  it('stores only the signed-in owner content and exposes enabled content consistently in JSON, BMP and raw pixels', async () => {
    const customImage = { width: 2, height: 1, pixels: 'fw==', fit: 'contain' };
    const response = await post({
      user_id: 'attacker', custom_text: 'Husk æbler', custom_image: customImage,
      show_custom_text: true, show_custom_image: true,
      layout: { version: 1, cols: 10, rows: 6, widgets: [
        { i: 'custom-text', x: 0, y: 0, w: 5, h: 3 }, { i: 'custom-image', x: 5, y: 0, w: 5, h: 3 },
      ] },
    });
    expect(response.status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner-id', expect.objectContaining({ custom_text: 'Husk æbler' }));
    expect(vi.mocked(upsertPreferences).mock.calls[0][1]).not.toHaveProperty('user_id');
    const saved = await (await fetch(`${baseUrl}/preferences`, { headers })).json() as { preferences: UserPreferences };
    expect(saved.preferences.custom_image).toEqual(customImage);
    const preview = await (await fetch(`${baseUrl}/preview`, { headers })).json() as DisplayData;
    expect(preview.customText).toBe('Husk æbler');
    expect(preview.customImage).toEqual(customImage);
    const bmp = Buffer.from(await (await fetch(`${baseUrl}/image/preview`, { headers })).arrayBuffer());
    const raw = Buffer.from(await (await fetch(`${baseUrl}/image/preview/raw`, { headers })).arrayBuffer());
    expect(bmp.subarray(62)).toEqual(raw);
    expect(raw.some((byte) => byte !== 0xff)).toBe(true);

    expect((await post({ show_custom_text: false, show_custom_image: false })).status).toBe(200);
    const disabled = await (await fetch(`${baseUrl}/preview`, { headers })).json();
    expect(disabled).not.toHaveProperty('customText');
    expect(disabled).not.toHaveProperty('customImage');
    const blank = Buffer.from(await (await fetch(`${baseUrl}/image/preview/raw`, { headers })).arrayBuffer());
    expect(blank.every((byte) => byte === 0xff)).toBe(true);
    expect(state.preferences.custom_text).toBe('Husk æbler');
  });

  it('rejects malformed custom input and never writes invalid state', async () => {
    for (const body of [{ custom_text: 'x'.repeat(2001) }, { custom_image: { width: 999999, pixels: 'AA==' } }, { show_custom_text: 1 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it('accepts the largest supported bitmap but bounds request size', async () => {
    const custom_image = { width: 512, height: 512, pixels: Buffer.alloc(32768, 0xff).toString('base64'), fit: 'cover' };
    expect((await post({ custom_image })).status).toBe(200);
    expect((await post({ custom_image, custom_text: 'x'.repeat(65536) })).status).toBe(413);
    expect(upsertPreferences).toHaveBeenCalledTimes(1);
  });

  it('requires authentication before saving any content', async () => {
    const response = await fetch(`${baseUrl}/preferences`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_text: 'private' }) });
    expect(response.status).toBe(401);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
});
