import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEnergyCache, fetchEnergyPrice } from '../services/energinet';

function record(time: string, price: number, area = 'DK1') {
  return { TimeUTC: time, PriceArea: area, DayAheadPriceDKK: price };
}

function respond(records: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ records }),
  }));
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
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.pathname).toBe('/dataset/DayAheadPrices');
    expect(url.searchParams.get('start')).toBe('StartOfDay');
    expect(url.searchParams.get('end')).toBe('StartOfDay+P1D');
    expect(JSON.parse(url.searchParams.get('filter')!)).toEqual({ PriceArea: ['DK1'] });
    expect(url.searchParams.get('limit')).toBe('100');
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
    respond([record('2026-10-25T00:00:00', 400), record('2026-10-25T01:00:00', 800)]);
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
    [record('invalid', 400)], [null],
  ].map((records) => ({ records })))('refuses missing, stale, future-only or malformed current data: $records', async ({ records }) => {
    respond(records);
    await expect(fetchEnergyPrice()).rejects.toThrow('current 15-minute interval');
  });

  it('does not cache failed upstream requests', async () => {
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
