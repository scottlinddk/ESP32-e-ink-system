import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { energinetPricesWidget } from '../widgets/energinet/index';

const danishTime = (minutes: number) =>
  `${new Date(Date.UTC(2026, 8, 26, 0, minutes)).toISOString().slice(0, 19)}+02:00`;
const FAKE_RECORDS = Array.from({ length: 96 }, (_, i) => ({
  DKK_per_kWh: (500 + i * 10) / 1000,
  EUR_per_kWh: (70 + i) / 1000,
  EXR: 7.46,
  time_start: danishTime(i * 15),
  time_end: danishTime(i * 15 + 15),
})).reverse(); // order is not relied on

const ELPRIS_URL = 'https://www.elprisenligenu.dk/api/v1/prices/2026/09-26_DK2.json';
const server = setupServer(http.get(ELPRIS_URL, () => HttpResponse.json(FAKE_RECORDS)));

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
    expect(result.data.hourlyPrices[0].hourDK).toBe('2026-09-26T00:00:00+02:00');
  });

  it('fetch returns ok:false when the day is not published', async () => {
    server.use(http.get(ELPRIS_URL, () => new HttpResponse(null, { status: 404 })));
    const result = await energinetPricesWidget.fetch(
      { priceArea: 'DK2' },
      { widthPx: 250, heightPx: 122 }
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining('404') });
  });

  it('fetch returns ok:false on API error', async () => {
    server.use(
      http.get('https://www.elprisenligenu.dk/api/v1/prices/2026/09-26_DK1.json', () =>
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
