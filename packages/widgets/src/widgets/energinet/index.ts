import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { EnergyPriceConfig, EnergyPriceData, EnergidataResponse } from './types';

const ENERGINET_BASE_URL = 'https://api.energidataservice.dk/dataset/Elspotprices';

export const configSchema = z.object({
  priceArea: z.enum(['DK1', 'DK2']).default('DK2'),
});

function dkkMwhToOreKwh(dkkPerMwh: number): number {
  return Math.round((dkkPerMwh / 10) * 100) / 100;
}

async function fetchPrices(priceArea: string): Promise<EnergyPriceData> {
  const filter = JSON.stringify({ PriceArea: priceArea });
  const url = `${ENERGINET_BASE_URL}?limit=24&filter=${encodeURIComponent(filter)}&sort=HourDK%20desc`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Energinet API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as EnergidataResponse;
  const records = json.records ?? [];

  if (records.length === 0) {
    throw new Error('No energy price data returned from Energinet');
  }

  const nowOre = dkkMwhToOreKwh(records[0].SpotPriceDKK);
  const averageOre =
    Math.round(
      (records.reduce((sum, r) => sum + dkkMwhToOreKwh(r.SpotPriceDKK), 0) / records.length) * 100
    ) / 100;

  const diffPct = averageOre === 0 ? 0 : Math.abs((nowOre - averageOre) / averageOre);
  const trend: 'up' | 'down' | 'stable' =
    diffPct < 0.05 ? 'stable' : nowOre > averageOre ? 'up' : 'down';

  const hourlyPrices = records.map((r) => ({
    hourDK: r.HourDK,
    priceOre: dkkMwhToOreKwh(r.SpotPriceDKK),
  }));

  return { nowOre, averageOre, trend, hourlyPrices };
}

export const energinetPricesWidget: Widget<EnergyPriceConfig, EnergyPriceData> = {
  meta: {
    id: 'energinet-prices',
    name: 'Danish Energy Prices',
    description: 'Spot electricity prices from Energinet (Elspot), updated every 15 minutes.',
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
    const priceText = `${(data.nowOre / 100).toFixed(2)} DKK/kWh`;
    const trendArrow = data.trend === 'up' ? '^' : data.trend === 'down' ? 'v' : '-';

    elements.push({ kind: 'text', text: priceText, x: 2, y: 2, fontSize: typography.xl });
    elements.push({
      kind: 'text',
      text: `Avg: ${(data.averageOre / 100).toFixed(2)} ${trendArrow}`,
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
