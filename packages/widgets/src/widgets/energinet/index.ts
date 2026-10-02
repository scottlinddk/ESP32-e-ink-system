import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { EnergyPriceConfig, EnergyPriceData, EnergidataResponse } from './types';

const ENERGINET_BASE_URL = 'https://api.energidataservice.dk/dataset/DayAheadPrices';
const INTERVAL_MS = 15 * 60 * 1000;
const danishDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const configSchema = z.object({
  priceArea: z.enum(['DK1', 'DK2']).default('DK2'),
});

function dkkMwhToOreKwh(dkkPerMwh: number): number {
  return Math.round((dkkPerMwh / 10) * 100) / 100;
}

async function fetchPrices(priceArea: string): Promise<EnergyPriceData> {
  const params = new URLSearchParams({
    start: 'StartOfDay', end: 'StartOfDay+P1D', limit: '100',
    filter: JSON.stringify({ PriceArea: [priceArea] }), sort: 'TimeUTC asc',
  });
  const url = `${ENERGINET_BASE_URL}?${params}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Energinet API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as EnergidataResponse;
  const now = Date.now();
  const today = danishDate.format(now);
  const records = (Array.isArray(json.records) ? json.records : [])
    .filter((r) => r && r.PriceArea === priceArea
      && typeof r.TimeUTC === 'string' && Number.isFinite(r.DayAheadPriceDKK))
    .map((r) => ({
      ...r,
      start: Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(r.TimeUTC) ? r.TimeUTC : `${r.TimeUTC}Z`),
    }))
    .filter((r) => Number.isFinite(r.start) && danishDate.format(r.start) === today)
    .sort((a, b) => a.start - b.start);

  const current = records.find((r) => r.start <= now && now < r.start + INTERVAL_MS);
  if (!current) {
    throw new Error('No energy price available for the current 15-minute interval');
  }

  const currentOre = current.DayAheadPriceDKK / 10;
  const average = records.reduce((sum, r) => sum + r.DayAheadPriceDKK / 10, 0) / records.length;
  const nowOre = dkkMwhToOreKwh(current.DayAheadPriceDKK);
  const averageOre = Math.round(average * 100) / 100;

  const trend: 'up' | 'down' | 'stable' =
    Math.abs(currentOre - average) <= Math.max(Math.abs(average) * 0.05, 0.01)
      ? 'stable' : currentOre > average ? 'up' : 'down';

  const hourlyPrices = records.map((r) => ({
    hourDK: r.TimeDK,
    priceOre: dkkMwhToOreKwh(r.DayAheadPriceDKK),
  }));

  return { nowOre, averageOre, trend, hourlyPrices };
}

export const energinetPricesWidget: Widget<EnergyPriceConfig, EnergyPriceData> = {
  meta: {
    id: 'energinet-prices',
    name: 'Danish Spot Prices',
    description: 'Danish day-ahead spot prices in 15-minute intervals, excluding taxes and tariffs.',
    category: 'energy',
  },

  configSchema,

  async fetch(
    config: EnergyPriceConfig,
    _region: PixelRegion
  ): Promise<WidgetResult<EnergyPriceData>> {
    try {
      const data = await fetchPrices(config.priceArea);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: EnergyPriceData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    const priceText = `Spot: ${(data.nowOre / 100).toFixed(2)} DKK/kWh`;
    const trendArrow = data.trend === 'up' ? '^' : data.trend === 'down' ? 'v' : '-';

    elements.push({ kind: 'text', text: priceText, x: 2, y: 2, fontSize: typography.xl });
    elements.push({
      kind: 'text',
      text: `Avg: ${(data.averageOre / 100).toFixed(2)} ${trendArrow}; excl tax/fees`,
      x: 2,
      y: typography.xl + 4,
      fontSize: typography.sm,
    });

    // Render histogram only when there is enough vertical space (Phase 4 enhances this)
    if (region.heightPx >= 80 && data.hourlyPrices.length > 0) {
      const chartY = typography.xl + typography.sm + 8;
      const chartH = region.heightPx - chartY - 2;
      if (chartH > 10) {
        elements.push({
          kind: 'bar-chart',
          x: 2,
          y: chartY,
          width: region.widthPx - 4,
          height: chartH,
          values: data.hourlyPrices.map((h) => h.priceOre),
        });
      }
    }

    return { region, elements };
  },
};
