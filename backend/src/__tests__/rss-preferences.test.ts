import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPreferences, upsertPreferences } from '../services/database';
import router from '../routes/preferences';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.clerkUserId = 'clerk-user'; next(); } }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));

describe('RSS settings persistence and validation', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getPreferences).mockResolvedValue(null); });
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('returns backwards-compatible defaults', async () => {
    const body = await (await fetch(url)).json() as { preferences: unknown };
    expect(body.preferences).toMatchObject({ news_source: 'newsapi', news_feed_url: '', news_item_limit: 3 });
  });
  it('saves source settings scoped to the authenticated owner', async () => {
    const settings = { news_source: 'rss', news_feed_url: 'https://example.org/rss', news_item_limit: 5 };
    vi.mocked(upsertPreferences).mockResolvedValue(settings as Awaited<ReturnType<typeof upsertPreferences>>);
    const response = await post({ ...settings, user_id: 'other' });
    expect(response.status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', settings);
    expect((await response.json() as { preferences: unknown }).preferences).toEqual(settings);
  });
  it.each([
    { news_source: 'other' }, { news_source: 'rss' }, { news_item_limit: 0 }, { news_item_limit: 11 }, { news_item_limit: 1.5 },
    { news_item_limit: '3' }, { news_feed_url: null }, { news_feed_url: 'http://example.org/rss' },
    { news_feed_url: 'https://127.0.0.1/rss' }, { news_feed_url: 'https://example.org/' + 'x'.repeat(2048) },
  ])('rejects invalid settings without saving: %j', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
  it('allows switching back to NewsAPI but prevents clearing an active RSS URL', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ news_source: 'rss', news_feed_url: 'https://example.org/rss' } as Awaited<ReturnType<typeof getPreferences>>);
    expect((await post({ news_feed_url: '' })).status).toBe(400);
    expect((await post({ news_source: 'newsapi', news_feed_url: '' })).status).toBe(200);
  });
});
