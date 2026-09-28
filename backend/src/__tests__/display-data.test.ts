import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { verifyToken } from '@clerk/backend';
import { getApiKeys, getPreferences } from '../services/database';
import { fetchEnergyPrice } from '../services/energinet';
import { fetchWeather } from '../services/weather';
import { fetchNews } from '../services/news';
import { fetchRssNews } from '../services/rss';
import { fetchCalendar } from '../services/calendar';
import { fetchMontaData } from '../services/monta';
import { fetchZaptecData } from '../services/zaptec';
import { fetchNotionData } from '../services/notion';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import displayDataRouter from '../routes/display-data';
import imageRouter from '../routes/image';
import { renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import type { ApiKey, DisplayData, UserPreferences } from '../types/index';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({
    users: { getUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: 'test@example.com' }] }) },
  })),
}));
vi.mock('../services/database', () => ({
  getApiKeys: vi.fn(),
  getPreferences: vi.fn(),
  upsertUser: vi.fn().mockResolvedValue({ id: 'user-test' }),
  logApiUsage: vi.fn(),
}));
vi.mock('../services/energinet', () => ({ fetchEnergyPrice: vi.fn() }));
vi.mock('../services/weather', () => ({ fetchWeather: vi.fn() }));
vi.mock('../services/news', () => ({ fetchNews: vi.fn() }));
vi.mock('../services/rss', () => ({ fetchRssNews: vi.fn() }));
vi.mock('../services/calendar', () => ({ fetchCalendar: vi.fn() }));
vi.mock('../services/monta', () => ({ fetchMontaData: vi.fn() }));
vi.mock('../services/zaptec', () => ({ fetchZaptecData: vi.fn() }));
vi.mock('../services/notion', () => ({ fetchNotionData: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const credentials = {
  openweathermap: 'weather-test-key',
  newsapi: 'news-test-key',
  monta: JSON.stringify({ clientId: 'client-test', clientSecret: 'secret-test' }),
  zaptec: JSON.stringify({ username: 'test@example.com', password: 'password-test' }),
  notion: JSON.stringify({ token: 'notion-test-key', databaseId: 'database-test' }),
};
const prefs: UserPreferences = {
  ...DEFAULT_PREFS,
  show_monta: true,
  show_zaptec: true,
  show_notion: true,
  refresh_interval_minutes: 45,
  monta_fields: ['today_stats'],
  zaptec_fields: ['active_session'],
  layout: {
    version: 1, cols: 10, rows: 6,
    widgets: [
      { i: 'monta', x: 0, y: 0, w: 5, h: 3 },
      { i: 'zaptec', x: 5, y: 0, w: 5, h: 3 },
      { i: 'notion', x: 0, y: 3, w: 10, h: 2 },
      { i: 'status', x: 0, y: 5, w: 10, h: 1 },
    ],
  },
};
const liveData: DisplayData = {
  nextRefresh: 45 * 60_000,
  price: { now: 75, average: 80, trend: 'down' },
  weather: { temp: 7, condition: 'cloudy', windSpeed: 3, icon: '04d' },
  news: [{ title: 'A verified headline', url: 'https://example.com/news' }],
  monta: { chargePoints: [], activeSessions: [], todayKwh: 8.5 },
  zaptec: { chargers: [], activeSession: null, installationName: 'Home' },
  notion: { databaseName: 'Tasks', rows: [{ id: 'task-1', title: 'Read the meter' }] },
};
const sources = [fetchEnergyPrice, fetchWeather, fetchNews, fetchMontaData, fetchZaptecData, fetchNotionData];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  vi.mocked(verifyToken).mockResolvedValue({ sub: 'clerk-test' } as Awaited<ReturnType<typeof verifyToken>>);
  vi.mocked(getPreferences).mockResolvedValue(prefs);
  vi.mocked(getApiKeys).mockResolvedValue(Object.entries(credentials).map(([provider, api_key]) => ({ provider, api_key } as ApiKey)));
  vi.mocked(fetchEnergyPrice).mockResolvedValue(liveData.price!);
  vi.mocked(fetchWeather).mockResolvedValue(liveData.weather!);
  vi.mocked(fetchNews).mockResolvedValue(liveData.news!);
  vi.mocked(fetchMontaData).mockResolvedValue(liveData.monta!);
  vi.mocked(fetchZaptecData).mockResolvedValue(liveData.zaptec!);
  vi.mocked(fetchNotionData).mockResolvedValue(liveData.notion!);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('live display data', () => {
  it('uses the encrypted calendar credential only when enabled and keeps empty calendars distinct from failures', async () => {
    const calendar = { timezone: 'Europe/Copenhagen', events: [] };
    vi.mocked(fetchCalendar).mockResolvedValue(calendar);
    expect((await buildDisplayData('user-test', { ...prefs, show_calendar: true }, { calendar: 'https://private.example.org/token' })).calendar).toEqual(calendar);
    expect(fetchCalendar).toHaveBeenCalledWith('https://private.example.org/token', { timezone: 'Europe/Copenhagen', days: 7, limit: 5 }, expect.any(AbortSignal));
    vi.mocked(fetchCalendar).mockRejectedValue(new Error('private URL must not leak'));
    expect((await buildDisplayData('user-test', { ...prefs, show_calendar: true }, { calendar: 'https://private.example.org/token' })).calendar).toBeUndefined();
    vi.mocked(fetchCalendar).mockClear();
    await buildDisplayData('user-test', { ...prefs, show_calendar: false }, { calendar: 'https://private.example.org/token' });
    await buildDisplayData('user-test', { ...prefs, show_calendar: true }, {});
    expect(fetchCalendar).not.toHaveBeenCalled();
  });
  it('selects RSS without NewsAPI credentials and preserves an empty successful feed', async () => {
    vi.mocked(fetchRssNews).mockResolvedValue([]);
    const selected = { ...prefs, news_source: 'rss' as const, news_feed_url: 'https://example.org/rss', news_item_limit: 5 };
    const result = await buildDisplayData('user-test', selected, {});
    expect(result.news).toEqual([]);
    expect(fetchRssNews).toHaveBeenCalledWith(selected.news_feed_url, 5, expect.any(AbortSignal));
    expect(fetchNews).not.toHaveBeenCalled();
  });

  it('omits failed feeds, keeps other data and does not silently fall back to NewsAPI', async () => {
    vi.mocked(fetchRssNews).mockRejectedValue(new Error('Malformed feed'));
    const result = await buildDisplayData('user-test', { ...prefs, news_source: 'rss' }, credentials);
    expect(result.news).toBeUndefined();
    expect(result.price).toEqual(liveData.price);
    expect(fetchNews).not.toHaveBeenCalled();
  });
  it('includes every enabled integration and forwards the selected fields and user identity', async () => {
    expect(await buildDisplayData('user-test', prefs, credentials)).toEqual(liveData);
    expect(fetchMontaData).toHaveBeenCalledWith('user-test', JSON.parse(credentials.monta), ['today_stats'], expect.any(AbortSignal));
    expect(fetchZaptecData).toHaveBeenCalledWith('user-test', JSON.parse(credentials.zaptec), ['active_session'], expect.any(AbortSignal));
    expect(fetchNotionData).toHaveBeenCalledWith('user-test', JSON.parse(credentials.notion), expect.any(AbortSignal));
    expect(fetchWeather).toHaveBeenCalledWith(prefs.weather_location, credentials.openweathermap, expect.any(AbortSignal));
    expect(fetchNews).toHaveBeenCalledWith(prefs.news_language, credentials.newsapi, expect.any(AbortSignal));
  });

  it('does not fetch disabled sources, even when credentials are configured', async () => {
    const disabledPrefs = {
      ...prefs, show_energy_price: false, show_weather: false, show_news: false,
      show_monta: false, show_zaptec: false, show_notion: false,
    };
    expect(await buildDisplayData('user-test', disabledPrefs, credentials)).toEqual({ nextRefresh: liveData.nextRefresh });
    for (const source of sources) expect(source).not.toHaveBeenCalled();
  });

  it('keeps successful readings and omits failing sources instead of substituting sample data', async () => {
    vi.mocked(fetchWeather).mockRejectedValue(new Error('Weather unavailable'));
    vi.mocked(fetchNews).mockRejectedValue(new Error('News unavailable'));
    vi.mocked(fetchZaptecData).mockRejectedValue(new Error('Charger unavailable'));
    const { weather, news, zaptec, ...availableData } = liveData;
    expect(await buildDisplayData('user-test', prefs, credentials)).toEqual(availableData);
  });

  it('skips missing or malformed integration credentials without losing other readings', async () => {
    const { monta, zaptec, notion, ...availableData } = liveData;
    expect(await buildDisplayData('user-test', prefs, {
      openweathermap: credentials.openweathermap,
      newsapi: credentials.newsapi,
      monta: '{invalid',
      notion: '{invalid',
    })).toEqual(availableData);
    expect(fetchMontaData).not.toHaveBeenCalled();
    expect(fetchZaptecData).not.toHaveBeenCalled();
    expect(fetchNotionData).not.toHaveBeenCalled();
  });

  it('returns healthy sources after 10 seconds even if providers ignore cancellation', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let finishWeather!: (value: NonNullable<DisplayData['weather']>) => void;
    let failNews!: (error: Error) => void;
    vi.mocked(fetchWeather).mockReturnValue(new Promise((resolve) => { finishWeather = resolve; }));
    vi.mocked(fetchNews).mockReturnValue(new Promise((_resolve, reject) => { failNews = reject; }));
    const pending = buildDisplayData('user-test', prefs, credentials);

    await vi.advanceTimersByTimeAsync(10_000);
    const data = await pending;
    const { weather, news, ...availableData } = liveData;
    expect(data).toEqual(availableData);
    expect(vi.mocked(fetchWeather).mock.calls[0][2]?.aborted).toBe(true);
    expect(vi.mocked(fetchNews).mock.calls[0][2]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // A late success cannot change an already returned payload, and a late
    // rejection remains handled by the race instead of becoming unhandled.
    finishWeather(liveData.weather!);
    failNews(new Error('Late failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(data).toEqual(availableData);
  });
});

describe('JSON, BMP and Bluetooth endpoints', () => {
  let server: Server;
  let baseUrl: string;
  const auth = { headers: { Authorization: 'Bearer test-token' } };

  beforeAll(async () => {
    const app = express();
    app.use('/preview', displayDataRouter);
    app.use('/image', imageRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('renders RSS headlines through JSON, BMP and raw display endpoints', async () => {
    const selected = { ...prefs, news_source: 'rss' as const, news_feed_url: 'https://example.org/rss', news_item_limit: 3,
      layout: { version: 1 as const, cols: 10 as const, rows: 6 as const, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6 }] } };
    const headlines = [{ title: 'Feed headline one', url: 'https://example.org/one' }, { title: 'Feed headline two', url: '' }];
    vi.mocked(getPreferences).mockResolvedValue(selected);
    vi.mocked(fetchRssNews).mockResolvedValue(headlines);
    const expected = { ...liveData, news: headlines };
    expect(await (await fetch(`${baseUrl}/preview`, auth)).json()).toEqual(expected);
    const bmp = Buffer.from(await (await fetch(`${baseUrl}/image/preview`, auth)).arrayBuffer());
    const raw = Buffer.from(await (await fetch(`${baseUrl}/image/preview/raw`, auth)).arrayBuffer());
    expect(bmp).toEqual(renderDisplayData(expected, selected.layout, selected));
    expect(raw).toEqual(renderDisplayDataRaw(expected, selected.layout, selected));
    expect(fetchNews).not.toHaveBeenCalled();
    expect(fetchRssNews).toHaveBeenCalledTimes(3);
  });

  it('renders the calendar in JSON, BMP and raw without returning its private URL', async () => {
    const selected = { ...prefs, show_calendar: true,
      layout: { version: 1 as const, cols: 10 as const, rows: 6 as const, widgets: [{ i: 'calendar', x: 0, y: 0, w: 10, h: 6 }] } };
    const calendar = { timezone: 'Europe/Copenhagen', events: [{ title: 'Appointment', start: '2026-09-28', end: '2026-09-29', allDay: true, dateLabel: '28 Sep', timeLabel: 'All day' }] };
    vi.mocked(getPreferences).mockResolvedValue(selected);
    vi.mocked(getApiKeys).mockResolvedValue([...Object.entries(credentials).map(([provider, api_key]) => ({ provider, api_key } as ApiKey)), { provider: 'calendar', api_key: 'https://private.example.org/secret-token' } as ApiKey]);
    vi.mocked(fetchCalendar).mockResolvedValue(calendar);
    const expected = { ...liveData, calendar };
    const json = await (await fetch(`${baseUrl}/preview`, auth)).json();
    expect(json).toEqual(expected); expect(JSON.stringify(json)).not.toContain('secret-token');
    const bmp = Buffer.from(await (await fetch(`${baseUrl}/image/preview`, auth)).arrayBuffer());
    const raw = Buffer.from(await (await fetch(`${baseUrl}/image/preview/raw`, auth)).arrayBuffer());
    expect(bmp).toEqual(renderDisplayData(expected, selected.layout, selected));
    expect(raw).toEqual(renderDisplayDataRaw(expected, selected.layout, selected));
    expect(fetchCalendar).toHaveBeenCalledTimes(3);
  });

  it('renders all three formats from the same enabled live integrations and field preferences', async () => {
    const jsonResponse = await fetch(`${baseUrl}/preview`, auth);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual(liveData);

    const bmpResponse = await fetch(`${baseUrl}/image/preview`, auth);
    const bmp = Buffer.from(await bmpResponse.arrayBuffer());
    expect(bmpResponse.status).toBe(200);
    expect(bmpResponse.headers.get('content-type')).toContain('image/bmp');
    expect(bmp).toEqual(renderDisplayData(liveData, prefs.layout, prefs));

    const rawResponse = await fetch(`${baseUrl}/image/preview/raw`, auth);
    const raw = Buffer.from(await rawResponse.arrayBuffer());
    expect(rawResponse.status).toBe(200);
    expect(rawResponse.headers.get('cache-control')).toBe('no-store');
    expect(raw).toHaveLength(3904);
    expect(raw).toEqual(renderDisplayDataRaw(liveData, prefs.layout, prefs));
    expect(raw).toEqual(bmp.subarray(62));
    for (const source of sources) expect(source).toHaveBeenCalledTimes(3);
  });

  it('does not put fabricated weather or headlines in any output when those sources fail', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ ...prefs, layout: null });
    vi.mocked(fetchWeather).mockRejectedValue(new Error('Weather unavailable'));
    vi.mocked(fetchNews).mockRejectedValue(new Error('News unavailable'));
    const { weather, news, ...availableData } = liveData;

    const jsonResponse = await fetch(`${baseUrl}/preview`, auth);
    expect(await jsonResponse.json()).toEqual(availableData);
    const bmpResponse = await fetch(`${baseUrl}/image/preview`, auth);
    expect(Buffer.from(await bmpResponse.arrayBuffer())).toEqual(renderDisplayData(availableData, null, prefs));
    const rawResponse = await fetch(`${baseUrl}/image/preview/raw`, auth);
    expect(Buffer.from(await rawResponse.arrayBuffer())).toEqual(renderDisplayDataRaw(availableData, null, prefs));
  });

  it.each(['/preview', '/image/preview', '/image/preview/raw'])('requires authentication for %s', async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(401);
    expect(getPreferences).not.toHaveBeenCalled();
    for (const source of sources) expect(source).not.toHaveBeenCalled();
  });
});
