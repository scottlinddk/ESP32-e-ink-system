import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { EnergyPriceConfig, EnergyPriceData, ElprisRecord } from './types';

const ELPRIS_BASE_URL = 'https://www.elprisenligenu.dk/api/v1/prices';
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/;
const danishDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const configSchema = z.object({
  priceArea: z.enum(['DK1', 'DK2']).default('DK2'),
});

async function fetchPrices(priceArea: string): Promise<EnergyPriceData> {
  const now = Date.now();
  const today = danishDate.format(now);
  const [year, month, day] = today.split('-');
  const url = `${ELPRIS_BASE_URL}/${year}/${month}-${day}_${priceArea}.json`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Elprisen lige nu API error: ${response.status} ${response.statusText}`);
  }

  const json: unknown = await response.json();
  const records = (Array.isArray(json) ? json as Partial<ElprisRecord>[] : [])
    .filter((r) => r && typeof r.time_start === 'string' && OFFSET_TIMESTAMP.test(r.time_start)
      && typeof r.time_end === 'string' && OFFSET_TIMESTAMP.test(r.time_end)
      && typeof r.DKK_per_kWh === 'number' && Number.isFinite(r.DKK_per_kWh))
    .map((r) => ({
      timeStart: r.time_start!,
      start: Date.parse(r.time_start!),
      end: Date.parse(r.time_end!),
      priceOre: r.DKK_per_kWh! * 100,
    }))
    .filter((r) => Number.isFinite(r.start) && r.start < r.end && danishDate.format(r.start) === today)
    .sort((a, b) => a.start - b.start);

  const current = records.find((r) => r.start <= now && now < r.end);
  if (!current) {
    throw new Error('No energy price available for the current interval');
  }

  const currentOre = current.priceOre;
  const average = records.reduce((sum, r) => sum + r.priceOre, 0) / records.length;
  const nowOre = Math.round(currentOre * 100) / 100;
  const averageOre = Math.round(average * 100) / 100;

  const trend: 'up' | 'down' | 'stable' =
    Math.abs(currentOre - average) <= Math.max(Math.abs(average) * 0.05, 0.01)
      ? 'stable' : currentOre > average ? 'up' : 'down';

  const hourlyPrices = records.map((r) => ({
    hourDK: r.timeStart,
    priceOre: Math.round(r.priceOre * 100) / 100,
  }));

  return { nowOre, averageOre, trend, hourlyPrices };
}

export const energinetPricesWidget: Widget<EnergyPriceConfig, EnergyPriceData> = {
  meta: {
    id: 'energinet-prices',
    name: 'Danish Spot Prices',
    description: 'Danish day-ahead spot prices from Elprisen lige nu, excluding VAT, taxes and tariffs.',
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
