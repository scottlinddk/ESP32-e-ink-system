import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { energinetPricesWidget } from '../widgets/energinet/index';

const FAKE_RECORDS = Array.from({ length: 96 }, (_, i) => ({
  TimeDK: new Date(Date.UTC(2026, 8, 26, 0, i * 15)).toISOString().slice(0, -1),
  TimeUTC: new Date(Date.UTC(2026, 8, 25, 22, i * 15)).toISOString().slice(0, -1),
  PriceArea: 'DK2',
  DayAheadPriceDKK: 500 + i * 10,
  DayAheadPriceEUR: 70 + i,
})).reverse(); // newest first

const server = setupServer(
  http.get('https://api.energidataservice.dk/dataset/DayAheadPrices', ({ request }) => {
    const url = new URL(request.url);
    const filter = JSON.parse(url.searchParams.get('filter') ?? '{}') as Record<string, string[]>;
    expect(url.searchParams.get('start')).toBe('StartOfDay');
    expect(url.searchParams.get('end')).toBe('StartOfDay+P1D');
    const records = FAKE_RECORDS.filter(
      (r) => !filter.PriceArea || filter.PriceArea.includes(r.PriceArea)
    );
    return HttpResponse.json({ total: records.length, limit: 100, dataset: 'DayAheadPrices', records });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-26T10:07:00Z'));
});
afterEach(() => { server.resetHandlers(); vi.useRealTimers(); });
afterAll(() => server.close());

describe('energinetPricesWidget', () => {
  it('meta.id is stable', () => {
    expect(energinetPricesWidget.meta.id).toBe('energinet-prices');
  });

  it('fetch returns ok:true with price data for DK2', async () => {
    const result = await energinetPricesWidget.fetch(
      { priceArea: 'DK2' },
      { widthPx: 250, heightPx: 122 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nowOre).toBe(98); // 12:00 Danish time, interval 48
    expect(result.data.averageOre).toBe(97.5);
    expect(result.data.trend).toBe('stable');
    expect(result.data.hourlyPrices).toHaveLength(96);
    expect(result.data.hourlyPrices[0].hourDK).toBe('2026-09-26T00:00:00.000');
  });

  it('fetch returns ok:false on API error', async () => {
    server.use(
      http.get('https://api.energidataservice.dk/dataset/DayAheadPrices', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );
    const result = await energinetPricesWidget.fetch(
      { priceArea: 'DK1' },
      { widthPx: 250, heightPx: 122 }
    );
    expect(result.ok).toBe(false);
  });

  it('render returns text elements at minimum', () => {
    const data = {
      nowOre: 120,
      averageOre: 100,
      trend: 'up' as const,
      hourlyPrices: [],
    };
    const rendered = energinetPricesWidget.render(
      data,
      { widthPx: 250, heightPx: 122 },
      { xs: 8, sm: 8, base: 10, lg: 12, xl: 16 }
    );
    expect(rendered.elements.some((e) => e.kind === 'text')).toBe(true);
  });

  it('render adds bar-chart when region is tall enough', () => {
    const data = {
      nowOre: 120,
      averageOre: 100,
      trend: 'stable' as const,
      hourlyPrices: Array.from({ length: 24 }, (_, i) => ({ hourDK: `${i}:00`, priceOre: 100 + i })),
    };
    const rendered = energinetPricesWidget.render(
      data,
      { widthPx: 400, heightPx: 300 },
      { xs: 10, sm: 12, base: 14, lg: 20, xl: 32 }
    );
    expect(rendered.elements.some((e) => e.kind === 'bar-chart')).toBe(true);
  });

  it('render omits bar-chart when region is shorter than 80px', () => {
    const data = {
      nowOre: 120,
      averageOre: 100,
      trend: 'down' as const,
      hourlyPrices: Array.from({ length: 24 }, (_, i) => ({ hourDK: `${i}:00`, priceOre: 100 + i })),
    };
    const rendered = energinetPricesWidget.render(
      data,
      { widthPx: 250, heightPx: 60 },
      { xs: 8, sm: 8, base: 10, lg: 12, xl: 16 }
    );
    expect(rendered.elements.some((e) => e.kind === 'bar-chart')).toBe(false);
  });
});
