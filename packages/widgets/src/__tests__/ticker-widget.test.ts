import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderedWidget } from '@esp32-eink/types';
import { createTickerWidget } from '../widgets/ticker';
import { QuoteProviderError, type QuoteProvider } from '../widgets/ticker/providers/QuoteProvider';
import { createYahooProvider } from '../widgets/ticker/providers/yahoo';
import { condensedLayout } from '../widgets/ticker/views/layout';
import type { MarketState, Quote } from '../widgets/ticker/types';
import { configSchema } from '../widgets/ticker/config';

const typography = { xs: 8, sm: 8, base: 10, lg: 12, xl: 16 };
const small = { widthPx: 250, heightPx: 122 };

const quote = (symbol: string, changePercent: number, over: Partial<Quote> = {}): Quote => {
  const previousClose = 100;
  const price = previousClose * (1 + changePercent / 100);
  return {
    symbol, name: symbol, currency: symbol.endsWith('.CO') ? 'DKK' : 'USD', exchange: 'X', price, previousClose,
    change: price - previousClose, changePercent, marketState: 'CLOSED' as MarketState,
    series: [99, 100, 101, 100, price], ...over,
  };
};

const provider = (map: Record<string, Quote | Error>): QuoteProvider => ({
  search: async () => [],
  quote: async (symbol) => {
    const value = map[symbol];
    if (!value) throw new QuoteProviderError('Symbol not found.');
    if (value instanceof Error) throw value;
    return value;
  },
});

const config = (input: Record<string, unknown>) => configSchema.parse(input);
const texts = (r: RenderedWidget) => r.elements.flatMap((e) => (e.kind === 'text' ? [e.text] : []));

/** Every element must stay inside the region: drawing is clipped, so overflow silently disappears. */
function expectInside(rendered: RenderedWidget) {
  const { widthPx, heightPx } = rendered.region;
  for (const e of rendered.elements) {
    const width = e.kind === 'text' ? e.text.length * e.fontSize : e.kind === 'hline' || e.kind === 'rect' || e.kind === 'bar-chart' ? e.width : 0;
    const height = e.kind === 'text' ? e.fontSize : e.kind === 'rect' || e.kind === 'bar-chart' ? e.height : 1;
    expect(e.x, JSON.stringify(e)).toBeGreaterThanOrEqual(0);
    expect(e.y, JSON.stringify(e)).toBeGreaterThanOrEqual(0);
    expect(e.x + width, JSON.stringify(e)).toBeLessThanOrEqual(widthPx);
    expect(e.y + height, JSON.stringify(e)).toBeLessThanOrEqual(heightPx);
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T12:31:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const stocks = provider({
  'NOVO-B.CO': quote('NOVO-B.CO', -1.24, { price: 612.4, previousClose: 620.1, change: -7.7 }),
  NVDA: quote('NVDA', 0.36), AAPL: quote('AAPL', -0.24), DSV: quote('DSV', 2),
  'DSV.CO': quote('DSV.CO', 2), 'VWS.CO': quote('VWS.CO', 0), SPOT: quote('SPOT', -0.76),
});

describe('ticker widget: fetch', () => {
  it('shows one stock per page in the full view and rotates with the clock', async () => {
    const widget = createTickerWidget(stocks);
    const cfg = config({ symbols: ['NVDA', 'AAPL'], dwellMinutes: 10 });
    const first = await widget.fetch(cfg, small);
    expect(first).toMatchObject({ ok: true, data: { page: expect.any(Number), pageCount: 2 } });
    vi.setSystemTime(new Date('2026-10-06T12:41:00Z'));
    const second = await widget.fetch(cfg, small);
    if (!first.ok || !second.ok) throw new Error('expected data');
    expect(first.data.rows).toHaveLength(1);
    expect(second.data.rows[0].symbol).not.toBe(first.data.rows[0].symbol);
  });

  it('never loads more symbols than the condensed region can draw', async () => {
    const quoteSpy = vi.fn(stocks.quote);
    const widget = createTickerWidget({ ...stocks, quote: quoteSpy });
    const cfg = config({ symbols: ['NVDA', 'AAPL', 'DSV', 'SPOT', 'VWS.CO', 'NOVO-B.CO'], view: 'condensed', perPage: 8 });
    const result = await widget.fetch(cfg, small);
    if (!result.ok) throw new Error('expected data');
    expect(result.data.rows.length).toBe(condensedLayout(small).rows);
    expect(quoteSpy).toHaveBeenCalledTimes(result.data.rows.length);
  });

  it('keeps a partial failure as an unavailable row and reports MIXED sessions', async () => {
    const widget = createTickerWidget(provider({
      NVDA: quote('NVDA', 1, { marketState: 'OPEN' }), AAPL: new QuoteProviderError('Yahoo Finance request limit reached.'),
      'VWS.CO': quote('VWS.CO', 1, { marketState: 'CLOSED' }),
    }));
    const result = await widget.fetch(config({ symbols: ['NVDA', 'AAPL', 'VWS.CO'], view: 'condensed', dwellMinutes: 1440 }), small);
    expect(result).toMatchObject({ ok: true, data: { marketStatus: 'MIXED' } });
    if (!result.ok) return;
    expect(result.data.rows.map((r) => !!r.quote)).toEqual([true, false, true]);
  });

  it('fails with a fixed diagnostic when every symbol fails', async () => {
    const widget = createTickerWidget(provider({ NVDA: new QuoteProviderError('Yahoo Finance request limit reached.') }));
    expect(await widget.fetch(config({ symbols: ['NVDA'] }), small)).toEqual({ ok: false, error: 'Yahoo Finance request limit reached.' });
    const leaky = createTickerWidget(provider({ NVDA: new Error('connect ECONNREFUSED https://secret.example') }));
    expect(await leaky.fetch(config({ symbols: ['NVDA'] }), small)).toEqual({ ok: false, error: 'Yahoo Finance is unavailable.' });
  });
});

describe('ticker widget: render', () => {
  it.each([['full'], ['condensed']] as const)('draws the %s view inside every common panel size', async (view) => {
    const widget = createTickerWidget(stocks);
    const symbols = ['NOVO-B.CO', 'NVDA', 'AAPL', 'DSV.CO', 'VWS.CO', 'SPOT'];
    for (const region of [small, { widthPx: 250, heightPx: 61 }, { widthPx: 125, heightPx: 122 }, { widthPx: 400, heightPx: 300 }, { widthPx: 800, heightPx: 480 }, { widthPx: 96, heightPx: 40 }]) {
      const result = await widget.fetch(config({ symbols, view }), region);
      if (!result.ok) throw new Error('expected data');
      expectInside(widget.render(result.data, region, typography));
    }
  });

  it('shows direction with a shape and a sign, in Danish format', async () => {
    const widget = createTickerWidget(stocks);
    const region = small;
    const result = await widget.fetch(config({ symbols: ['NOVO-B.CO'], view: 'condensed' }), region);
    if (!result.ok) throw new Error('expected data');
    const rendered = widget.render(result.data, region, typography);
    expect(texts(rendered)).toEqual(expect.arrayContaining(['NOVO-B', '612,40 kr', '-7,70 (-1,24 %)', 'CLOSED']));
    // Down arrow: widest row first.
    const widths = rendered.elements.filter((e) => e.kind === 'rect').map((e) => (e as { width: number }).width);
    expect(widths.slice(0, 4)).toEqual([7, 5, 3, 1]);
  });

  it('does not draw an unsupported triangle glyph (the font renders it as ?)', async () => {
    const widget = createTickerWidget(stocks);
    for (const view of ['full', 'condensed'] as const) {
      const result = await widget.fetch(config({ symbols: ['NVDA'], view }), small);
      if (!result.ok) throw new Error('expected data');
      expect(texts(widget.render(result.data, small, typography)).join('')).not.toMatch(/[▲▼▴▾]/u);
    }
  });

  it('shows the page indicator only when there is more than one page', async () => {
    const widget = createTickerWidget(stocks);
    const many = await widget.fetch(config({ symbols: ['NVDA', 'AAPL', 'DSV', 'SPOT', 'VWS.CO', 'NOVO-B.CO'], view: 'condensed', perPage: 2, locale: 'en' }), small);
    const one = await widget.fetch(config({ symbols: ['NVDA'], view: 'condensed', locale: 'en' }), small);
    if (!many.ok || !one.ok) throw new Error('expected data');
    expect(texts(widget.render(many.data, small, typography)).some((t) => /^Page \d\/3$/.test(t))).toBe(true);
    expect(texts(widget.render(one.data, small, typography)).some((t) => t.startsWith('Page'))).toBe(false);
  });

  it('marks an unavailable symbol instead of inventing a price', async () => {
    const widget = createTickerWidget(provider({ NVDA: quote('NVDA', 1), AAPL: new QuoteProviderError('x') }));
    const region = small;
    const result = await widget.fetch(config({ symbols: ['NVDA', 'AAPL'], view: 'condensed', dwellMinutes: 1440 }), region);
    if (!result.ok) throw new Error('expected data');
    expect(texts(widget.render(result.data, region, typography))).toContain('n/a');
  });
});

describe('condensedLayout', () => {
  it('uses two-line rows when at least three fit, else one-line rows', () => {
    expect(condensedLayout(small)).toMatchObject({ twoLine: true, rows: 4 });
    expect(condensedLayout({ widthPx: 250, heightPx: 61 })).toMatchObject({ twoLine: false, chrome: true });
    expect(condensedLayout({ widthPx: 250, heightPx: 30 })).toMatchObject({ chrome: false, rows: 2 });
  });
  it('always has at least one row', () => {
    expect(condensedLayout({ widthPx: 10, heightPx: 5 }).rows).toBe(1);
  });
});

describe('Yahoo provider', () => {
  const chart = (meta: Record<string, unknown>, close: Array<number | null> = [1, null, 2]) =>
    new Response(JSON.stringify({ chart: { result: [{ meta, indicators: { quote: [{ close }] } }] } }));
  const meta = {
    symbol: 'NOVO-B.CO', currency: 'DKK', exchangeName: 'CPH', longName: 'Novo Nordisk A/S', regularMarketPrice: 612.4, chartPreviousClose: 620.1,
    currentTradingPeriod: { regular: { start: 1_790_000_000, end: 1_790_010_000 } },
  };

  it('maps a Danish chart response and drops null candles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chart(meta));
    const value = await createYahooProvider({ fetchImpl }).quote('NOVO-B.CO');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/v8/finance/chart/NOVO-B.CO?range=1d');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(value).toMatchObject({ symbol: 'NOVO-B.CO', currency: 'DKK', price: 612.4, previousClose: 620.1, series: [1, 2], marketState: 'CLOSED' });
    expect(value.changePercent).toBeCloseTo(-1.2417, 3);
  });
  it('encodes the symbol into the path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chart(meta));
    await createYahooProvider({ fetchImpl }).quote('^GSPC');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/chart/%5EGSPC?');
  });
  it('caches quotes for a minute but not failures', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => chart(meta));
    const yahoo = createYahooProvider({ fetchImpl, now: () => clock });
    await yahoo.quote('A'); await yahoo.quote('A');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock = 61_000; await yahoo.quote('A');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const limited = createYahooProvider({ fetchImpl: failing });
    await expect(limited.quote('B')).rejects.toThrow('request limit');
    await expect(limited.quote('B')).rejects.toThrow('request limit');
    expect(failing).toHaveBeenCalledTimes(2);
  });
  it.each([[404, 'Symbol not found.'], [500, 'Yahoo Finance is unavailable.']])('maps HTTP %s to a fixed message', async (status, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('secret body', { status }));
    await expect(createYahooProvider({ fetchImpl }).quote('X')).rejects.toThrow(message);
  });
  it.each([[{ ...meta, regularMarketPrice: 'x' }], [{ ...meta, chartPreviousClose: 0 }], [{ ...meta, currency: undefined }]])('rejects malformed data %#', async (bad) => {
    const fetchImpl = vi.fn().mockResolvedValue(chart(bad));
    await expect(createYahooProvider({ fetchImpl }).quote('X')).rejects.toThrow('invalid data');
  });
  it('turns network errors into a fixed message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo https://leak'));
    await expect(createYahooProvider({ fetchImpl }).quote('X')).rejects.toThrow('Yahoo Finance is unavailable.');
  });

  const search = new Response(JSON.stringify({ quotes: [
    { symbol: 'NOVO-B.CO', longname: 'Novo Nordisk A/S', exchange: 'CPH', exchDisp: 'Copenhagen', quoteType: 'EQUITY' },
    { symbol: 'NVO', shortname: 'Novo Nordisk', exchange: 'NYQ', exchDisp: 'NYSE', quoteType: 'EQUITY' },
    { symbol: 'NOVO.X', exchange: 'CPH', quoteType: 'MUTUALFUND' },
  ] }));
  it('searches equities, and can be limited to Copenhagen', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => search.clone());
    const yahoo = createYahooProvider({ fetchImpl });
    expect((await yahoo.search('novo')).map((r) => r.symbol)).toEqual(['NOVO-B.CO', 'NVO']);
    expect((await yahoo.search('novo', 'dk')).map((r) => r.symbol)).toEqual(['NOVO-B.CO']);
    expect(await yahoo.search('   ')).toEqual([]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('q=novo');
  });
});
