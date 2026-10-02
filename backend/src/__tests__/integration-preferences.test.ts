import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPreferences, upsertPreferences, upsertApiKey } from '../services/database';
import router from '../routes/preferences';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.clerkUserId = 'clerk-owner'; next(); } }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));

describe('integration preferences share template validation', () => {
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

  it.each(['energy_price', 'weather', 'news', 'air_quality', 'monta', 'zaptec', 'notion', 'calendar', 'custom_text', 'custom_image', 'custom_webhook'])(
    'rejects truthy non-boolean show_%s without partially saving', async (source) => {
      expect((await post({ display_timezone: 'UTC', [`show_${source}`]: 'false' })).status).toBe(400);
      expect(upsertPreferences).not.toHaveBeenCalled();
    });
  it.each([
    { refresh_interval_minutes: 0 }, { refresh_interval_minutes: 1441 }, { refresh_interval_minutes: 1.5 },
    { refresh_interval_minutes: '30' }, { news_language: 'xx' }, { monta_fields: 'active_session' },
    { monta_fields: ['installation_info'] }, { zaptec_fields: ['today_stats'] },
    { zaptec_fields: ['charger_status', 'charger_status'] }, { monta_fields: [null] },
    { layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'unknown', x: 0, y: 0, w: 10, h: 6 }] } },
  ])('rejects invalid source options atomically: %j', async (invalid) => {
    expect((await post({ show_weather: false, ...invalid })).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
  it('accepts partial settings without overwriting omitted values or account ownership', async () => {
    const patch = { show_notion: false, refresh_interval_minutes: 1440, news_language: 'fi', monta_fields: [], zaptec_fields: ['charger_status', 'installation_info'] };
    expect((await post({ ...patch, user_id: 'other', api_key: 'private' })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', patch);
  });
  it('allows an empty disabled RSS draft but requires a URL when enabling it', async () => {
    expect((await post({ show_news: false, news_source: 'rss', news_feed_url: '' })).status).toBe(200);
    vi.mocked(getPreferences).mockResolvedValue({ show_news: false, news_source: 'rss', news_feed_url: '' } as Awaited<ReturnType<typeof getPreferences>>);
    vi.mocked(upsertPreferences).mockClear();
    expect((await post({ show_news: true })).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
    expect((await post({ show_weather: false })).status).toBe(200);
    expect((await post({ show_news: true, news_feed_url: 'https://example.org/feed.xml' })).status).toBe(200);
  });
  it('still rejects unsafe feed URLs when news is disabled', async () => {
    expect((await post({ show_news: false, news_source: 'rss', news_feed_url: 'http://localhost/feed' })).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  const credentials = (provider: string, input: unknown) => fetch(url + '/ev-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, credentials: input }) });
  it.each([
    ['monta', { clientId: {}, clientSecret: 'secret' }], ['monta', { clientId: ' ', clientSecret: 'secret' }],
    ['zaptec', { username: 'user', password: 123 }], ['zaptec', { username: 'user', password: 'x'.repeat(4097) }],
    ['notion', { token: {}, databaseId: 'id' }], ['notion', { token: 'ntn_test', databaseId: 'https://evil.example/abc' }],
    ['notion', []],
  ])('rejects invalid %s credentials without storing them', async (provider, input) => {
    expect((await credentials(provider as string, input)).status).toBe(400);
    expect(upsertApiKey).not.toHaveBeenCalled();
  });
  it('normalizes modern Notion credentials and preserves intentional password spaces', async () => {
    vi.mocked(upsertApiKey).mockResolvedValue({ provider: 'notion', created_at: 'now' } as Awaited<ReturnType<typeof upsertApiKey>>);
    const databaseId = '12345678-1234-1234-1234-123456789abc';
    expect((await credentials('notion', { token: ' ntn_test ', databaseId: 'https://www.notion.so/Tasks-12345678123412341234123456789abc' })).status).toBe(200);
    expect(upsertApiKey).toHaveBeenCalledWith('owner', 'notion', JSON.stringify({ token: 'ntn_test', databaseId }));
    expect((await credentials('zaptec', { username: ' owner ', password: ' padded ', extra: 'omit' })).status).toBe(200);
    expect(upsertApiKey).toHaveBeenCalledWith('owner', 'zaptec', JSON.stringify({ username: 'owner', password: ' padded ' }));
  });
});
