import { describe, expect, it, vi } from 'vitest';
import { createYahooProvider } from '../ticker/providers/yahoo';

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
