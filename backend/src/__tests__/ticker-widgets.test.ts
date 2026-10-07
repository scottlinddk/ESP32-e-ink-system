import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPreferences, upsertPreferences } from '../services/database';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import router from '../routes/preferences';
import tickersRouter from '../routes/tickers';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import { exportDisplayTemplate } from '../utils/displayTemplates';
import { MAX_TICKER_WIDGETS, parseTickerWidgets, storedTickerWidgets, tickerIdFromWidget, TickerWidgetValidationError } from '../utils/tickerWidgets';
import { loadTickerSnapshots, renderTicker } from '../ticker';
import { QuoteProviderError, type QuoteProvider } from '../ticker/providers/QuoteProvider';
import type { Quote } from '../ticker/types';
import type { DisplayLayout, TickerWidgetSetting, UserPreferences } from '../types';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.headers.authorization) { res.status(401).json({ error: 'Sign-in required' }); return; }
  req.clerkUserId = 'clerk-user'; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
vi.mock('../services/energinet', () => ({ fetchEnergyPrice: vi.fn() }));
vi.mock('../services/weather', () => ({ fetchWeather: vi.fn() }));
vi.mock('../services/news', () => ({ fetchNews: vi.fn() }));

const realFetch = globalThis.fetch; // captured before any test stubs it; local requests must reach the test server

const dk: TickerWidgetSetting = { id: 'dk', name: 'Danske', symbols: ['NOVO-B.CO', 'DSV.CO', 'VWS.CO'], view: 'condensed', per_page: null, dwell_minutes: 15, locale: 'da' };
const us: TickerWidgetSetting = { id: 'us1', name: '', symbols: ['NVDA'], view: 'full', per_page: null, dwell_minutes: 15, locale: 'en' };
const grid = (...widgets: DisplayLayout['widgets']): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets });

const quote = (symbol: string, changePercent: number): Quote => {
  const previousClose = 100;
  const price = previousClose * (1 + changePercent / 100);
  return {
    symbol, name: symbol, currency: symbol.endsWith('.CO') ? 'DKK' : 'USD', exchange: 'X', price, previousClose,
    change: price - previousClose, changePercent, marketState: 'CLOSED',
    series: Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 3 + (i / 60) * changePercent),
  };
};
const provider = (map: Record<string, Quote | string>): QuoteProvider => ({
  search: async () => [],
  quote: vi.fn(async (symbol: string) => {
    const value = map[symbol];
    if (typeof value === 'string') throw new QuoteProviderError(value);
    if (!value) throw new QuoteProviderError('Symbol not found.');
    return value;
  }),
});

describe('ticker widget list validation', () => {
  it('normalises symbols, trims names and removes duplicates', () => {
    expect(parseTickerWidgets([{ ...dk, name: '  Danske ', symbols: [' novo-b.co', 'NOVO-B.CO', 'dsv.co'] }]))
      .toEqual([{ ...dk, symbols: ['NOVO-B.CO', 'DSV.CO'] }]);
    expect(parseTickerWidgets([])).toEqual([]);
  });
  it('treats a missing per_page as automatic', () => {
    const { per_page: _omit, ...withoutPerPage } = us;
    expect(parseTickerWidgets([withoutPerPage])[0].per_page).toBeNull();
  });
  it.each([
    ['not a list', {}],
    ['too many widgets', Array.from({ length: MAX_TICKER_WIDGETS + 1 }, (_, n) => ({ ...us, id: `t${n}` }))],
    ['duplicate IDs', [us, { ...dk, id: 'us1' }]],
    ['uppercase ID', [{ ...us, id: 'US' }]],
    ['ID with a colon', [{ ...us, id: 'a:b' }]],
    ['missing name', [{ ...us, name: undefined }]],
    ['long name', [{ ...us, name: 'x'.repeat(25) }]],
    ['unknown field', [{ ...us, secret: 'x' }]],
    ['no symbols', [{ ...us, symbols: [] }]],
    ['eleven symbols', [{ ...us, symbols: Array.from({ length: 11 }, (_, n) => `S${n}`) }]],
    ['path-like symbol', [{ ...us, symbols: ['../etc'] }]],
    ['non-string symbol', [{ ...us, symbols: [1] }]],
    ['unknown view', [{ ...us, view: 'wide' }]],
    ['zero per_page', [{ ...us, per_page: 0 }]],
    ['nine per_page', [{ ...us, per_page: 9 }]],
    ['zero dwell', [{ ...us, dwell_minutes: 0 }]],
    ['fractional dwell', [{ ...us, dwell_minutes: 1.5 }]],
    ['unknown locale', [{ ...us, locale: 'fr' }]],
  ])('rejects %s', (_name, value) => {
    expect(() => parseTickerWidgets(value)).toThrow(TickerWidgetValidationError);
  });
  it('treats invalid stored data as no widgets instead of failing the display', () => {
    expect(storedTickerWidgets(undefined)).toEqual([]);
    expect(storedTickerWidgets('garbage')).toEqual([]);
    expect(storedTickerWidgets([dk])).toEqual([dk]);
  });
  it('maps only well-formed ticker:<id> widgets to IDs', () => {
    expect(tickerIdFromWidget('ticker:dk')).toBe('dk');
    for (const bad of ['ticker', 'ticker:', 'ticker:DK', 'ticker:a:b', 'news:dk', 'ticker:' + 'a'.repeat(17)]) {
      expect(tickerIdFromWidget(bad)).toBeNull();
    }
  });
});

describe('layouts with ticker widgets', () => {
  it('accepts ticker widgets next to the built-in ones', () => {
    const layout = grid({ i: 'energy', x: 0, y: 0, w: 10, h: 2 }, { i: 'ticker:dk', x: 0, y: 2, w: 5, h: 3 }, { i: 'ticker:us1', x: 5, y: 2, w: 5, h: 3 });
    expect(parseDisplayLayout(layout)).toEqual(layout);
  });
  it.each(['ticker:', 'ticker:DK', 'ticker:a:b', 'stocks:dk'])('rejects malformed widget ID %s', (i) => {
    expect(() => parseDisplayLayout(grid({ i, x: 0, y: 0, w: 2, h: 1 }))).toThrow(LayoutValidationError);
  });
  it('rejects the same ticker placed twice', () => {
    expect(() => parseDisplayLayout(grid({ i: 'ticker:dk', x: 0, y: 0, w: 2, h: 1 }, { i: 'ticker:dk', x: 2, y: 0, w: 2, h: 1 }))).toThrow(LayoutValidationError);
  });
});

describe('loading ticker snapshots', () => {
  it('requests a symbol shared by several widgets once', async () => {
    const quotes = provider({ 'NOVO-B.CO': quote('NOVO-B.CO', -1), 'DSV.CO': quote('DSV.CO', 2), 'VWS.CO': quote('VWS.CO', 0) });
    const result = await loadTickerSnapshots([dk, { ...dk, id: 'again', symbols: ['DSV.CO'] }], quotes);
    expect(quotes.quote).toHaveBeenCalledTimes(3);
    expect(result.dk).toMatchObject({ snapshot: { rows: [{ symbol: 'NOVO-B.CO' }, { symbol: 'DSV.CO' }, { symbol: 'VWS.CO' }] } });
    expect(result.again).toMatchObject({ snapshot: { rows: [{ symbol: 'DSV.CO' }] } });
  });
  it('keeps a partial failure as an unavailable row', async () => {
    const result = await loadTickerSnapshots([dk], provider({ 'NOVO-B.CO': quote('NOVO-B.CO', 1), 'DSV.CO': 'Yahoo Finance request limit reached.', 'VWS.CO': quote('VWS.CO', 1) }));
    if (!('snapshot' in result.dk)) throw new Error('expected a snapshot');
    expect(result.dk.snapshot.rows.map((row) => !!row.quote)).toEqual([true, false, true]);
  });
  it('fails a widget only when every symbol fails, with a fixed message', async () => {
    const throwing: QuoteProvider = { search: async () => [], quote: async () => { throw new Error('connect ECONNREFUSED https://secret.example'); } };
    expect(await loadTickerSnapshots([us], throwing)).toEqual({ us1: { error: 'Yahoo Finance is unavailable.' } });
    expect(await loadTickerSnapshots([us], provider({ NVDA: 'Symbol not found.' }))).toEqual({ us1: { error: 'Symbol not found.' } });
  });
});

/** Counts black pixels (raw rows are 32 bytes for 250 px, 0 = black) inside and outside a pixel box. */
function inkInside(raw: Buffer, box: { x: number; y: number; w: number; h: number }) {
  const rowBytes = 32;
  let inside = 0; let outside = 0;
  for (let y = 0; y < 122; y++) for (let x = 0; x < 250; x++) {
    if (raw[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) continue;
    if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) inside++; else outside++;
  }
  return { inside, outside };
}


/** Two texts on the same rows must not share columns: they would be drawn over each other. */
function expectNoTextOverlap(rendered: { elements: Array<{ kind: string; x: number; y: number; text?: string; fontSize?: number }> }, label: string) {
  const texts = rendered.elements.filter((e) => e.kind === 'text') as Array<{ x: number; y: number; text: string; fontSize: number }>;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i]; const b = texts[j];
    const rows = a.y < b.y + b.fontSize && b.y < a.y + a.fontSize;
    const columns = a.x < b.x + b.text.length * b.fontSize && b.x < a.x + a.text.length * a.fontSize;
    expect(rows && columns, `${label}: "${a.text}" overlaps "${b.text}"`).toBe(false);
  }
}

describe('ticker layout in small widgets', () => {
  const quotes = provider({ 'NOVO-B.CO': quote('NOVO-B.CO', -1.24), 'DSV.CO': quote('DSV.CO', 2.1), 'VWS.CO': quote('VWS.CO', 0), NVDA: quote('NVDA', 0.36) });
  it.each([[125, 122], [250, 122], [250, 61], [125, 60], [250, 20], [100, 40], [400, 300], [800, 480]])('keeps %i x %i free of overlapping text', async (widthPx, heightPx) => {
    const tickers = await loadTickerSnapshots([dk, us], quotes);
    for (const widget of [dk, us, { ...dk, view: 'full' as const }, { ...us, locale: 'da' as const }]) {
      const result = tickers[widget.id];
      if (!('snapshot' in result)) throw new Error('expected a snapshot');
      expectNoTextOverlap(renderTicker(widget, result.snapshot, { widthPx, heightPx }, 'Europe/Copenhagen'), `${widget.view} ${widthPx}x${heightPx}`);
    }
  });
  it('never cuts the percentage off inside a bracket', async () => {
    const tickers = await loadTickerSnapshots([{ ...us, view: 'full' }], quotes);
    const result = tickers.us1;
    if (!('snapshot' in result)) throw new Error('expected a snapshot');
    const texts = renderTicker({ ...us, view: 'full' }, result.snapshot, { widthPx: 125, heightPx: 122 }, 'Europe/Copenhagen').elements
      .flatMap((e) => (e.kind === 'text' ? [e.text] : []));
    expect(texts.every((t) => (t.match(/\(/g) ?? []).length === (t.match(/\)/g) ?? []).length)).toBe(true);
  });
});

describe('rendering ticker widgets', () => {
  const prefs = { ticker_widgets: [dk, us] };
  const blank = renderDisplayDataRaw({ nextRefresh: 1000 }, grid());
  const quotes = provider({ 'NOVO-B.CO': quote('NOVO-B.CO', -1.24), 'DSV.CO': quote('DSV.CO', 2.1), 'VWS.CO': quote('VWS.CO', 0), NVDA: quote('NVDA', 0.36) });
  const snapshots = () => loadTickerSnapshots([dk, us], quotes);

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T12:31:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('draws inside its own widget area and nowhere else', async () => {
    const tickers = await snapshots();
    // 10 columns × 6 rows on 250 × 122: x 0–125, y 0–60 is w 5, h 3.
    const raw = renderDisplayDataRaw({ nextRefresh: 1000, tickers }, grid({ i: 'ticker:dk', x: 0, y: 0, w: 5, h: 3 }), prefs);
    const ink = inkInside(raw, { x: 0, y: 0, w: 125, h: 60 });
    expect(ink.inside).toBeGreaterThan(150);
    expect(ink.outside).toBe(0);
  });
  it('draws the full view with a sparkline and the condensed view as a list', async () => {
    const tickers = await snapshots();
    const full = renderDisplayDataRaw({ nextRefresh: 1000, tickers }, grid({ i: 'ticker:us1', x: 0, y: 0, w: 10, h: 6 }), prefs);
    const condensed = renderDisplayDataRaw({ nextRefresh: 1000, tickers }, grid({ i: 'ticker:dk', x: 0, y: 0, w: 10, h: 6 }), prefs);
    expect(full).not.toEqual(blank);
    expect(condensed).not.toEqual(blank);
    expect(full).not.toEqual(condensed);
    expect(inkInside(full, { x: 0, y: 0, w: 250, h: 122 }).inside).toBeGreaterThan(400);
  });
  it('shows up and down moves differently', async () => {
    const draw = async (change: number) => renderDisplayDataRaw({
      nextRefresh: 1000, tickers: await loadTickerSnapshots([us], provider({ NVDA: { ...quote('NVDA', change), series: [] } })),
    }, grid({ i: 'ticker:us1', x: 0, y: 0, w: 10, h: 3 }), { ticker_widgets: [us] });
    expect(await draw(1.5)).not.toEqual(await draw(-1.5));
  });
  it('cycles to the next page once the dwell time has passed', async () => {
    const small = { ...dk, per_page: 1, dwell_minutes: 10 };
    const tickers = await loadTickerSnapshots([small], quotes);
    const draw = () => renderDisplayDataRaw({ nextRefresh: 1000, tickers }, grid({ i: 'ticker:dk', x: 0, y: 0, w: 10, h: 3 }), { ticker_widgets: [small] });
    const first = draw();
    expect(draw()).toEqual(first);
    vi.setSystemTime(new Date('2026-10-06T12:41:00Z'));
    expect(draw()).not.toEqual(first);
  });
  it('shows a removed widget or failed source as unavailable, never as stale data', async () => {
    const layout = grid({ i: 'ticker:dk', x: 0, y: 0, w: 10, h: 3 });
    const removed = renderDisplayDataRaw({ nextRefresh: 1000 }, layout, { ticker_widgets: [] });
    expect(removed).not.toEqual(blank);
    const failed = renderDisplayDataRaw({ nextRefresh: 1000, tickers: { dk: { error: 'Yahoo Finance request limit reached.' } } }, layout, prefs);
    expect(failed).not.toEqual(removed);
  });
  it('lets a placement override the view and stocks per page', async () => {
    const tickers = await snapshots();
    const place = (options?: DisplayLayout['widgets'][number]['options']) => renderDisplayDataRaw({ nextRefresh: 1000, tickers },
      grid({ i: 'ticker:dk', x: 0, y: 0, w: 10, h: 6, ...(options ? { options } : {}) }), prefs);
    const condensed = place();
    const asFull = place({ view: 'full' });
    expect(asFull).not.toEqual(condensed);
    // The same symbols drawn as the full view by the ticker's own setting.
    expect(asFull).toEqual(renderDisplayDataRaw({ nextRefresh: 1000, tickers }, grid({ i: 'ticker:dk', x: 0, y: 0, w: 10, h: 6 }),
      { ticker_widgets: [{ ...dk, view: 'full' }, us] }));
    expect(place({ items: 1 })).toEqual(renderDisplayDataRaw({ nextRefresh: 1000, tickers }, grid({ i: 'ticker:dk', x: 0, y: 0, w: 10, h: 6 }),
      { ticker_widgets: [{ ...dk, per_page: 1 }, us] }));
    expect(place({ items: 1 })).not.toEqual(condensed);
  });
  it('does not draw ticker widgets that are not in the layout', async () => {
    expect(renderDisplayDataRaw({ nextRefresh: 1000, tickers: await snapshots() }, grid(), prefs)).toEqual(blank);
  });
});

describe('display data for ticker widgets', () => {
  const base: UserPreferences = { ...DEFAULT_PREFS, show_energy_price: false, show_weather: false, show_news: false };
  afterEach(() => { vi.unstubAllGlobals(); });
  const chart = (symbol: string) => new Response(JSON.stringify({ chart: { result: [{
    meta: { symbol, currency: 'DKK', regularMarketPrice: 110, chartPreviousClose: 100 }, indicators: { quote: [{ close: [100, 110] }] },
  }] } }));

  it('loads configured widgets and leaves tickers absent when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => chart(decodeURIComponent(String(url).split('/chart/')[1].split('?')[0]))));
    const data = await buildDisplayData('user', { ...base, ticker_widgets: [{ ...us, id: 'x1', symbols: ['TICKA.CO'] }] }, {});
    expect(data.tickers?.x1).toMatchObject({ snapshot: { rows: [{ symbol: 'TICKA.CO', quote: { price: 110, changePercent: 10 } }] } });
    expect((await buildDisplayData('user', { ...base, ticker_widgets: [] }, {})).tickers).toBeUndefined();
  });
  it('does not let a Yahoo outage break the rest of the display', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SECRET network failure')));
    const data = await buildDisplayData('user', { ...base, ticker_widgets: [{ ...us, id: 'x2', symbols: ['TICKB'] }] }, {});
    expect(data.tickers?.x2).toEqual({ error: 'Yahoo Finance is unavailable.' });
    expect(JSON.stringify(data)).not.toContain('SECRET');
  });
});

describe('saving ticker widgets and searching symbols', () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router); app.use('/tickers', tickersRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { vi.mocked(upsertPreferences).mockReset(); vi.mocked(getPreferences).mockResolvedValue(null); });
  const auth = { Authorization: 'Bearer test' };
  const post = (body: unknown) => fetch(`${origin}/preferences`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });

  it('defaults to no ticker widgets', async () => {
    expect((await (await fetch(`${origin}/preferences`, { headers: auth })).json() as { preferences: UserPreferences }).preferences.ticker_widgets).toEqual([]);
  });
  it('saves a validated list for the authenticated owner', async () => {
    vi.mocked(upsertPreferences).mockResolvedValue({} as UserPreferences);
    expect((await post({ ticker_widgets: [{ ...dk, name: ' Danske ', symbols: ['novo-b.co'] }] })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', { ticker_widgets: [{ ...dk, symbols: ['NOVO-B.CO'] }] });
  });
  it('rejects an invalid list without saving', async () => {
    const response = await post({ ticker_widgets: [{ ...dk, symbols: ['bad symbol'] }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('ticker symbols') });
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
  it('keeps ticker widgets out of exported templates', () => {
    expect(exportDisplayTemplate({ ...DEFAULT_PREFS, ticker_widgets: [dk] }).settings).not.toHaveProperty('ticker_widgets');
  });

  describe('GET /tickers/search', () => {
    const yahoo = { quotes: [
      { symbol: 'NOVO-B.CO', longname: 'Novo Nordisk A/S', exchange: 'CPH', exchDisp: 'Copenhagen', quoteType: 'EQUITY' },
      { symbol: 'NVO', shortname: 'Novo Nordisk', exchange: 'NYQ', exchDisp: 'NYSE', quoteType: 'EQUITY' },
    ] };
    afterEach(() => { vi.unstubAllGlobals(); });
    const search = (query: string) => fetch(`${origin}/tickers/search?${query}`, { headers: auth });

    it('requires sign-in', async () => {
      expect((await fetch(`${origin}/tickers/search?q=novo`)).status).toBe(401);
    });
    it.each(['', 'q=', `q=${'x'.repeat(41)}`, 'q=novo&region=eu'])('rejects the query "%s"', async (query) => {
      expect((await search(query)).status).toBe(400);
    });
    it('returns equities and can be limited to Copenhagen', async () => {
      const upstream = vi.fn().mockImplementation(async () => new Response(JSON.stringify(yahoo)));
      // Only Yahoo is stubbed; the test client still reaches the local server.
      vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
        String(input).includes('yahoo.com') ? upstream(String(input)) : realFetch(input, init));
      const all = await (await search('q=novo+nordisk')).json() as { results: Array<{ symbol: string }> };
      expect(all.results.map((r) => r.symbol)).toEqual(['NOVO-B.CO', 'NVO']);
      const danish = await (await search('q=novo+nordisk&region=dk')).json() as { results: Array<{ symbol: string }> };
      expect(danish.results.map((r) => r.symbol)).toEqual(['NOVO-B.CO']);
    });
    it('reports an upstream failure as 502 with a fixed message', async () => {
      vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
        String(input).includes('yahoo.com') ? Promise.reject(new Error('SECRET dns failure')) : realFetch(input, init));
      const response = await search('q=failing+query');
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Yahoo Finance is unavailable.' });
    });
  });
});
