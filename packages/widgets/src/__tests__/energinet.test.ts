import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { energinetPricesWidget } from '../widgets/energinet/index';

const FAKE_RECORDS = Array.from({ length: 24 }, (_, i) => ({
  HourDK: `2024-01-01T${String(i).padStart(2, '0')}:00:00`,
  HourUTC: `2024-01-01T${String(i).padStart(2, '0')}:00:00`,
  PriceArea: 'DK2',
  SpotPriceDKK: 500 + i * 10, // varies 500–730 DKK/MWh
  SpotPriceEUR: 70 + i,
})).reverse(); // newest first

const server = setupServer(
  http.get('https://api.energidataservice.dk/dataset/Elspotprices', ({ request }) => {
    const url = new URL(request.url);
    const filter = JSON.parse(decodeURIComponent(url.searchParams.get('filter') ?? '{}')) as Record<string, string>;
    const records = FAKE_RECORDS.filter(
      (r) => !filter.PriceArea || r.PriceArea === filter.PriceArea
    );
    return HttpResponse.json({ total: records.length, limit: 24, dataset: 'Elspotprices', records });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
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
    expect(result.data.nowOre).toBeGreaterThan(0);
    expect(result.data.averageOre).toBeGreaterThan(0);
    expect(['up', 'down', 'stable']).toContain(result.data.trend);
    expect(result.data.hourlyPrices).toHaveLength(24);
  });

  it('fetch returns ok:false on API error', async () => {
    server.use(
      http.get('https://api.energidataservice.dk/dataset/Elspotprices', () =>
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
