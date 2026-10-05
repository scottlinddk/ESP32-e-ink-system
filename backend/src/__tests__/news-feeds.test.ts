import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchNews } from '../services/news';
import { fetchRssNews } from '../services/rss';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { getPreferences, upsertPreferences } from '../services/database';
import router from '../routes/preferences';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import { MAX_NEWS_FEEDS, newsFeedIdFromWidget, NewsFeedValidationError, parseNewsFeeds, storedNewsFeeds } from '../utils/newsFeeds';
import { exportDisplayTemplate } from '../utils/displayTemplates';
import type { DisplayLayout, NewsFeed, UserPreferences } from '../types';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.clerkUserId = 'clerk-user'; next(); } }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
vi.mock('../services/news', () => ({ fetchNews: vi.fn() }));
vi.mock('../services/rss', () => ({ fetchRssNews: vi.fn() }));
vi.mock('../services/energinet', () => ({ fetchEnergyPrice: vi.fn().mockResolvedValue({ now: 100, average: 100, trend: 'stable' }) }));
vi.mock('../services/weather', () => ({ fetchWeather: vi.fn().mockResolvedValue({ temp: 10, condition: 'Clear', windSpeed: 1, icon: '01d' }) }));

const dr: NewsFeed = { id: 'dr', name: 'DR', feed_url: 'https://www.dr.dk/nyheder/service/feeds/allenyheder', item_limit: 3 };
const bbc: NewsFeed = { id: 'bbc1', name: '', feed_url: 'https://feeds.bbci.co.uk/news/rss.xml', item_limit: 5 };
const grid = (...widgets: DisplayLayout['widgets']): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets });

describe('news feed list validation', () => {
  it('accepts unique feeds and trims names', () => {
    expect(parseNewsFeeds([{ ...dr, name: '  DR  ' }, bbc])).toEqual([dr, bbc]);
    expect(parseNewsFeeds([])).toEqual([]);
  });
  it.each([
    ['not a list', {}],
    ['too many feeds', Array.from({ length: MAX_NEWS_FEEDS + 1 }, (_, n) => ({ ...dr, id: `f${n}` }))],
    ['duplicate IDs', [dr, { ...bbc, id: 'dr' }]],
    ['uppercase ID', [{ ...dr, id: 'DR' }]],
    ['ID with a colon', [{ ...dr, id: 'a:b' }]],
    ['missing name', [{ id: 'dr', feed_url: dr.feed_url, item_limit: 3 }]],
    ['long name', [{ ...dr, name: 'x'.repeat(41) }]],
    ['unknown field', [{ ...dr, secret: 'x' }]],
    ['zero limit', [{ ...dr, item_limit: 0 }]],
    ['fractional limit', [{ ...dr, item_limit: 1.5 }]],
    ['HTTP URL', [{ ...dr, feed_url: 'http://example.org/rss' }]],
    ['private URL', [{ ...dr, feed_url: 'https://127.0.0.1/rss' }]],
    ['empty URL', [{ ...dr, feed_url: '' }]],
  ])('rejects %s', (_name, value) => {
    expect(() => parseNewsFeeds(value)).toThrow(NewsFeedValidationError);
  });
  it('treats invalid stored data as no feeds instead of failing the display', () => {
    expect(storedNewsFeeds(undefined)).toEqual([]);
    expect(storedNewsFeeds('garbage')).toEqual([]);
    expect(storedNewsFeeds([dr])).toEqual([dr]);
  });
  it('maps only well-formed news:<id> widgets to feed IDs', () => {
    expect(newsFeedIdFromWidget('news:dr')).toBe('dr');
    expect(newsFeedIdFromWidget('news')).toBeNull();
    expect(newsFeedIdFromWidget('news:')).toBeNull();
    expect(newsFeedIdFromWidget('news:DR')).toBeNull();
    expect(newsFeedIdFromWidget('weather')).toBeNull();
  });
});

describe('layouts with several news widgets', () => {
  it('accepts the original news widget together with feed widgets', () => {
    const layout = grid({ i: 'news', x: 0, y: 0, w: 5, h: 2 }, { i: 'news:dr', x: 5, y: 0, w: 5, h: 2 }, { i: 'news:bbc1', x: 0, y: 2, w: 10, h: 2 });
    expect(parseDisplayLayout(layout)).toEqual(layout);
  });
  it('allows the default widgets plus one widget per possible feed', () => {
    const feeds = Array.from({ length: MAX_NEWS_FEEDS }, (_, n) => ({ i: `news:f${n}`, x: n % 10, y: Math.floor(n / 10), w: 1, h: 1 }));
    expect(parseDisplayLayout(grid(...feeds, { i: 'news', x: 0, y: 2, w: 10, h: 1 })).widgets).toHaveLength(MAX_NEWS_FEEDS + 1);
  });
  it.each(['news:', 'news:DR', 'news:a:b', 'news:' + 'a'.repeat(17), 'rss:dr'])('rejects malformed widget ID %s', (i) => {
    expect(() => parseDisplayLayout(grid({ i, x: 0, y: 0, w: 2, h: 1 }))).toThrow(LayoutValidationError);
  });
  it('rejects the same feed placed twice', () => {
    expect(() => parseDisplayLayout(grid({ i: 'news:dr', x: 0, y: 0, w: 2, h: 1 }, { i: 'news:dr', x: 2, y: 0, w: 2, h: 1 })))
      .toThrow(LayoutValidationError);
  });
});

describe('display data for additional feeds', () => {
  const prefs: UserPreferences = { ...DEFAULT_PREFS, show_energy_price: false, show_weather: false, news_source: 'rss', news_feed_url: 'https://example.org/rss', news_feeds: [dr, bbc] };
  beforeEach(() => { vi.mocked(fetchRssNews).mockReset(); vi.mocked(fetchNews).mockReset(); });

  it('fetches each feed with its own limit and keeps one failure isolated', async () => {
    vi.mocked(fetchRssNews).mockImplementation(async (url) => {
      if (url === bbc.feed_url) throw new Error('SECRET feed failure');
      return [{ title: url === dr.feed_url ? 'DR headline' : 'Primary headline', url: 'https://example.org/a' }];
    });
    const data = await buildDisplayData('user', prefs, {});
    expect(fetchRssNews).toHaveBeenCalledWith(dr.feed_url, 3, expect.any(AbortSignal));
    expect(fetchRssNews).toHaveBeenCalledWith(bbc.feed_url, 5, expect.any(AbortSignal));
    expect(data.news).toEqual([{ title: 'Primary headline', url: 'https://example.org/a' }]);
    expect(data.newsFeeds?.dr).toEqual({ items: [{ title: 'DR headline', url: 'https://example.org/a' }] });
    expect(data.newsFeeds?.bbc1?.error?.code).toBe('unavailable');
    expect(JSON.stringify(data)).not.toContain('SECRET');
  });
  it('does not fetch additional feeds when news is turned off or none are configured', async () => {
    expect((await buildDisplayData('user', { ...prefs, show_news: false }, {})).newsFeeds).toBeUndefined();
    vi.mocked(fetchRssNews).mockResolvedValue([]);
    expect((await buildDisplayData('user', { ...prefs, news_feeds: [] }, {})).newsFeeds).toBeUndefined();
    expect(fetchRssNews).toHaveBeenCalledTimes(1);
  });
});

describe('rendering additional feed widgets', () => {
  const layout = grid({ i: 'news:dr', x: 0, y: 0, w: 10, h: 3 });
  const blank = renderDisplayDataRaw({ nextRefresh: 1000 }, grid());
  it('draws the headlines of the referenced feed only', () => {
    const own = renderDisplayDataRaw({ nextRefresh: 1000, newsFeeds: { dr: { items: [{ title: 'Feed headline', url: '' }] } } }, layout);
    const other = renderDisplayDataRaw({ nextRefresh: 1000, newsFeeds: { dr: { items: [{ title: 'Other words', url: '' }] } } }, layout);
    expect(own).not.toEqual(blank);
    expect(own).not.toEqual(other);
    expect(renderDisplayDataRaw({ nextRefresh: 1000, news: [{ title: 'Feed headline', url: '' }] }, layout))
      .not.toEqual(own);
  });
  it('shows a removed or failed feed as unavailable, and hides feeds when news is off', () => {
    const missing = renderDisplayDataRaw({ nextRefresh: 1000 }, layout);
    expect(missing).not.toEqual(blank);
    expect(renderDisplayDataRaw({ nextRefresh: 1000, newsFeeds: { dr: { error: { code: 'timeout', message: '' } } } }, layout)).not.toEqual(missing);
    expect(renderDisplayDataRaw({ nextRefresh: 1000 }, layout, { show_news: false })).toEqual(blank);
  });
});

describe('saving additional feeds', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { vi.mocked(upsertPreferences).mockReset(); vi.mocked(getPreferences).mockResolvedValue(null); });
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('defaults to no additional feeds', async () => {
    expect((await (await fetch(url)).json() as { preferences: UserPreferences }).preferences.news_feeds).toEqual([]);
  });
  it('saves a validated feed list for the authenticated owner', async () => {
    vi.mocked(upsertPreferences).mockResolvedValue({} as UserPreferences);
    expect((await post({ news_feeds: [{ ...dr, name: ' DR ' }, bbc] })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', { news_feeds: [dr, bbc] });
  });
  it('rejects an invalid feed list without saving', async () => {
    const response = await post({ news_feeds: [{ ...dr, feed_url: 'https://localhost/rss' }] });
    expect(response.status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
  it('keeps feed URLs out of exported templates', () => {
    expect(exportDisplayTemplate({ ...DEFAULT_PREFS, news_feeds: [dr] }).settings).not.toHaveProperty('news_feeds');
  });
});
