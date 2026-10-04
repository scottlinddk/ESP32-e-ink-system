import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEnergyCache, fetchEnergyPrice } from '../services/energinet';

// `time` is a UTC instant without suffix and `price` is DKK/MWh, as in the test cases' arithmetic.
function record(time: string, price: number, area = 'DK1', minutes = 15) {
  const start = Date.parse(`${time}Z`);
  return {
    area, DKK_per_kWh: price / 1000, EUR_per_kWh: price / 7460, EXR: 7.46, time_start: `${time}Z`,
    time_end: Number.isFinite(start) ? new Date(start + minutes * 60_000).toISOString() : time,
  };
}

function spotFor(url: URL, records: unknown[]) {
  const area = url.pathname.match(/_(DK[12])\.json$/)?.[1];
  return records.filter((r) => !(r && typeof r === 'object' && 'area' in r) || r.area === area);
}

function respond(records: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string) => ({
    ok: true, json: async () => spotFor(new URL(input), records),
  })));
}

beforeEach(() => {
  clearEnergyCache();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-26T10:07:00Z'));
});
afterEach(() => {
  clearEnergyCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('current Danish day-ahead electricity price', () => {
  it('selects the current quarter hour, not the latest published price', async () => {
    respond([
      record('2026-09-26T21:45:00', 2000),
      record('2026-09-26T10:15:00', 600),
      record('2026-09-26T10:00:00', 400),
    ]);
    expect(await fetchEnergyPrice()).toEqual({ now: 40, average: 100, trend: 'down' });
    expect(vi.mocked(fetch).mock.calls[0][0])
      .toBe('https://www.elprisenligenu.dk/api/v1/prices/2026/09-26_DK1.json');
  });

  it('requests the Danish calendar day, not the UTC day', async () => {
    vi.setSystemTime(new Date('2026-09-25T22:07:00Z'));
    respond([record('2026-09-25T22:00:00', 400)]);
    await fetchEnergyPrice('DK2').catch(() => undefined);
    expect(vi.mocked(fetch).mock.calls[0][0])
      .toBe('https://www.elprisenligenu.dk/api/v1/prices/2026/09-26_DK2.json');
  });

  it('accepts Danish UTC offsets and hourly intervals', async () => {
    respond([{ ...record('2026-09-26T10:00:00', 400, 'DK1', 60),
      time_start: '2026-09-26T12:00:00+02:00', time_end: '2026-09-26T13:00:00+02:00' }]);
    expect((await fetchEnergyPrice()).now).toBe(40);
    vi.setSystemTime(new Date('2026-09-26T10:59:59Z'));
    expect((await fetchEnergyPrice()).now).toBe(40);
    expect(fetch).toHaveBeenCalledTimes(1); // Cached until the hourly interval ends.
  });

  it('rejects timestamps without a UTC offset', async () => {
    respond([{ ...record('2026-09-26T10:00:00', 400), time_start: '2026-09-26T10:00:00' }]);
    await expect(fetchEnergyPrice()).rejects.toThrow('current interval');
  });

  it('expires cached current prices at the next interval boundary', async () => {
    respond([record('2026-09-26T10:00:00', 400), record('2026-09-26T10:15:00', 800)]);
    expect((await fetchEnergyPrice()).now).toBe(40);
    vi.setSystemTime(new Date('2026-09-26T10:14:59Z'));
    expect((await fetchEnergyPrice()).now).toBe(40);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-26T10:15:00Z'));
    expect((await fetchEnergyPrice()).now).toBe(80);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests and keeps regions separate', async () => {
    respond([record('2026-09-26T10:00:00', 400), record('2026-09-26T10:00:00', 900, 'DK2')]);
    const [first, second] = await Promise.all([fetchEnergyPrice(), fetchEnergyPrice()]);
    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await fetchEnergyPrice('DK2')).now).toBe(90);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses the Danish calendar day across a UTC date boundary', async () => {
    vi.setSystemTime(new Date('2026-09-25T22:07:00Z'));
    respond([
      record('2026-09-25T21:45:00', 9000),
      record('2026-09-25T22:00:00', 400),
      record('2026-09-26T21:45:00', 600),
      record('2026-09-26T22:00:00', 9000),
    ]);
    expect(await fetchEnergyPrice()).toEqual({ now: 40, average: 50, trend: 'down' });
  });

  it.each([
    ['2026-10-25T00:07:00Z', 40],
    ['2026-10-25T01:07:00Z', 80],
  ])('distinguishes the repeated Danish 02:00 hour at %s', async (time, price) => {
    vi.setSystemTime(new Date(time));
    respond([
      { ...record('2026-10-25T00:00:00', 400), time_start: '2026-10-25T02:00:00+02:00', time_end: '2026-10-25T02:15:00+02:00' },
      { ...record('2026-10-25T01:00:00', 800), time_start: '2026-10-25T02:00:00+01:00', time_end: '2026-10-25T02:15:00+01:00' },
    ]);
    expect((await fetchEnergyPrice()).now).toBe(price);
  });

  it('does not mistake the spring clock change for a gap in UTC intervals', async () => {
    vi.setSystemTime(new Date('2026-03-29T01:07:00Z'));
    respond([record('2026-03-29T00:45:00', 400), record('2026-03-29T01:00:00', 800)]);
    expect((await fetchEnergyPrice()).now).toBe(80);
  });

  it.each([
    [0, 0, 'stable'], [100, -100, 'up'], [-100, 100, 'down'], [-200, -100, 'down'],
  ])('handles zero and negative prices (%s, %s)', async (current, other, trend) => {
    respond([record('2026-09-26T10:00:00', current), record('2026-09-26T11:00:00', other)]);
    expect((await fetchEnergyPrice()).trend).toBe(trend);
  });

  it.each([
    [], [record('2025-09-26T10:00:00', 400)], [record('2026-09-26T10:15:00', 400)],
    [record('2026-09-26T10:00:00', Number.NaN)],
    [record('invalid', 400)], [null], [{ ...record('2026-09-26T10:00:00', 400), DKK_per_kWh: '0.4' }],
  ].map((records) => ({ records })))('refuses missing, stale, future-only or malformed current data: $records', async ({ records }) => {
    respond(records);
    await expect(fetchEnergyPrice()).rejects.toThrow('current interval');
  });

  it('refuses a non-array response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ records: [] }) }));
    await expect(fetchEnergyPrice()).rejects.toThrow('current interval');
  });

  it('does not cache failed upstream requests, including unpublished days', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }));
    await expect(fetchEnergyPrice()).rejects.toThrow('Elprisen lige nu API error: 404');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' }));
    await expect(fetchEnergyPrice()).rejects.toThrow('503');
    respond([record('2026-09-26T10:00:00', 400)]);
    expect((await fetchEnergyPrice()).now).toBe(40);
  });

  it('rejects an unsupported price area without fetching', async () => {
    respond([]);
    await expect(fetchEnergyPrice('DE')).rejects.toThrow('DK1 or DK2');
    expect(fetch).not.toHaveBeenCalled();
  });
});

const consumer = {
  mode: 'consumer' as const, gridGln: '5790000705689', gridChargeCodes: ['DT_C_01'], retailerMarkupOre: 5,
};
function tariff(code: string, price: number, overrides: Record<string, unknown> = {}) {
  return { GLN_Number: '5790000432752', ChargeType: 'D03', ChargeTypeCode: code,
    ValidFrom: '2026-01-01T00:00:00', ValidTo: '2027-01-01T00:00:00',
    ResolutionDuration: 'P1D', Price1: price, ...overrides };
}
function nationalTariffs() {
  return [tariff('40000', 0.043), tariff('41000', 0.072), tariff('EA-001', 0.008)];
}
function gridTariff(overrides: Record<string, unknown> = {}) {
  return tariff('DT_C_01', 0.10, { GLN_Number: consumer.gridGln, ResolutionDuration: 'PT1H', ...overrides });
}
function respondConsumer(spot: unknown[], tariffs = [...nationalTariffs(), gridTariff()]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === 'www.elprisenligenu.dk') return { ok: true, json: async () => spotFor(url, spot) };
    const filter = JSON.parse(url.searchParams.get('filter')!);
    const records = tariffs.filter((r) =>
      filter.GLN_Number.includes(r.GLN_Number) && filter.ChargeTypeCode.includes(r.ChargeTypeCode));
    return { ok: true, json: async () => ({ records }) };
  }));
}

describe('estimated Danish consumer electricity price', () => {
  it('keeps shared public requests alive when their first consumer cancels', async () => {
    respondConsumer([record('2026-09-26T10:00:00', 400)]);
    const aborted = new AbortController();
    const first = fetchEnergyPrice('DK1', aborted.signal, consumer);
    const second = fetchEnergyPrice('DK1', undefined, consumer);
    aborted.abort(new Error('caller cancelled'));
    await expect(first).rejects.toThrow('caller cancelled');
    expect((await second).now).toBe(84.13);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.signal?.aborted === false)).toBe(true);
  });
  it('adds each interval tariff, national charges and markup before VAT and averages the totals', async () => {
    vi.setSystemTime(new Date('2026-09-26T15:47:00Z')); // 17:47 Danish peak hour.
    respondConsumer([record('2026-09-26T14:45:00', 400), record('2026-09-26T15:45:00', 400)],
      [...nationalTariffs(), gridTariff({ Price17: 0.10, Price18: 0.90 })]);
    expect(await fetchEnergyPrice('DK1', undefined, consumer)).toEqual({
      now: 184.13, average: 134.13, trend: 'up', basis: 'consumer',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [input] of vi.mocked(fetch).mock.calls.slice(1)) {
      const url = new URL(input as string);
      expect(url.searchParams.has('start')).toBe(false);
      expect(url.searchParams.get('limit')).toBe('0');
      expect(url.searchParams.get('columns')).toContain('Price24');
      expect(JSON.parse(url.searchParams.get('filter')!).ChargeType).toEqual(['D03']);
    }
  });

  it('keeps spot, markup and grid profiles separate while reusing raw upstream data', async () => {
    respondConsumer([record('2026-09-26T10:00:00', 400)], [...nationalTariffs(), gridTariff(),
      gridTariff({ GLN_Number: '5790000705184', Price1: 0.20 })]);
    const [first, second] = await Promise.all([
      fetchEnergyPrice('DK1', undefined, consumer),
      fetchEnergyPrice('DK1', undefined, { ...consumer, retailerMarkupOre: 15 }),
    ]);
    expect(second.now - first.now).toBeCloseTo(12.5);
    expect((await fetchEnergyPrice()).now).toBe(40);
    expect(fetch).toHaveBeenCalledTimes(3);
    const other = await fetchEnergyPrice('DK1', undefined, { ...consumer, gridGln: '5790000705184' });
    expect(other.now - first.now).toBeCloseTo(12.5);
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date('2026-09-26T10:15:00Z'));
    respondConsumer([record('2026-09-26T10:15:00', 800)]);
    expect((await fetchEnergyPrice('DK1', undefined, consumer)).now).toBe(134.13);
    expect(fetch).toHaveBeenCalledTimes(1); // Only spot expires at the quarter-hour.
  });

  it('selects valid tariff versions by Danish day and refreshes them at local midnight', async () => {
    vi.setSystemTime(new Date('2026-09-25T21:47:00Z'));
    const tariffs = [...nationalTariffs(),
      gridTariff({ Price1: 0.20, ValidFrom: '2026-09-26T00:00:00' }),
      gridTariff({ Price1: 0.10, ValidTo: '2026-09-26T00:00:00' })];
    respondConsumer([record('2026-09-25T21:45:00', 400), record('2026-09-25T22:00:00', 400)], tariffs);
    const before = await fetchEnergyPrice('DK1', undefined, consumer);
    vi.setSystemTime(new Date('2026-09-25T22:07:00Z'));
    const after = await fetchEnergyPrice('DK1', undefined, consumer);
    expect(after.now - before.now).toBeCloseTo(12.5);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it.each(['2026-10-25T00:07:00Z', '2026-10-25T01:07:00Z'])(
    'uses Danish hourly tariffs in both repeated autumn hours: %s', async (instant) => {
      vi.setSystemTime(new Date(instant));
      respondConsumer([
        { ...record('2026-10-25T00:00:00', 400), time_start: '2026-10-25T02:00:00+02:00', time_end: '2026-10-25T02:15:00+02:00' },
        { ...record('2026-10-25T01:00:00', 400), time_start: '2026-10-25T02:00:00+01:00', time_end: '2026-10-25T02:15:00+01:00' },
      ],
        [...nationalTariffs(), gridTariff({ Price2: 9, Price3: 0.20, Price4: 9 })]);
      expect((await fetchEnergyPrice('DK1', undefined, consumer)).now).toBe(96.63);
    });

  it('skips the missing local spring hour when averaging tariffs', async () => {
    vi.setSystemTime(new Date('2026-03-29T01:07:00Z'));
    respondConsumer([record('2026-03-29T00:45:00', 400), record('2026-03-29T01:00:00', 400)],
      [...nationalTariffs(), gridTariff({ Price2: 0.10, Price3: 9, Price4: 0.20 })]);
    expect(await fetchEnergyPrice('DK1', undefined, consumer)).toMatchObject({ now: 96.63, average: 90.38 });
  });

  it('uses Price1 for null hourly slots, while keeping zero and negative additive tariffs', async () => {
    respondConsumer([record('2026-09-26T10:00:00', -100)], [...nationalTariffs(), gridTariff({ Price13: 0 }),
      gridTariff({ ChargeTypeCode: 'discount', Price1: -0.05, Price13: null })]);
    const settings = { ...consumer, gridChargeCodes: ['DT_C_01', 'discount'], retailerMarkupOre: 0 };
    expect((await fetchEnergyPrice('DK1', undefined, settings)).now).toBe(-3.37);
  });

  it.each([
    { ValidTo: '2026-09-26T00:00:00' }, { ValidFrom: '2026-09-27T00:00:00' },
    { ChargeTypeCode: 'unknown' }, { ChargeType: 'D01' }, { GLN_Number: '5790000705184' },
    { ValidFrom: 'invalid' }, { Price1: null }, { Price13: '0.1' }, { ResolutionDuration: 'PT15M' },
  ])('refuses missing, expired and malformed required tariffs without a spot fallback: %j', async (bad) => {
    respondConsumer([record('2026-09-26T10:00:00', 400)], [...nationalTariffs(), gridTariff(bad)]);
    await expect(fetchEnergyPrice('DK1', undefined, consumer)).rejects.toThrow(/tariff/);
  });

  it('refuses missing national taxes and retries failed data instead of caching the failure', async () => {
    respondConsumer([record('2026-09-26T10:00:00', 400)], [...nationalTariffs().slice(0, 2), gridTariff()]);
    await expect(fetchEnergyPrice('DK1', undefined, consumer)).rejects.toThrow('EA-001');
    respondConsumer([record('2026-09-26T10:00:00', 400)]);
    expect((await fetchEnergyPrice('DK1', undefined, consumer)).now).toBe(84.13);
  });
});
