import { EnergyPrice, EnergidataResponse, EnergidataRecord, CacheEntry } from '../types/index';

const ENERGINET_BASE_URL = 'https://api.energidataservice.dk/dataset/Elspotprices';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const cache = new Map<string, CacheEntry<EnergyPrice>>();

function getCacheKey(priceArea: string): string {
  return `energinet:${priceArea}`;
}

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

/**
 * Converts DKK/MWh to øre/kWh: divide by 10
 */
function dkkMwhToOreKwh(dkkPerMwh: number): number {
  return Math.round((dkkPerMwh / 10) * 100) / 100;
}

export async function fetchEnergyPrice(priceArea: string = 'DK1'): Promise<EnergyPrice> {
  const cacheKey = getCacheKey(priceArea);
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  const filter = JSON.stringify({ PriceArea: priceArea });
  const url = `${ENERGINET_BASE_URL}?limit=24&filter=${encodeURIComponent(filter)}&sort=HourDK%20desc`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Energinet API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as EnergidataResponse;
  const records: EnergidataRecord[] = json.records ?? [];

  if (records.length === 0) {
    throw new Error('No energy price data returned from Energinet');
  }

  // Current hour is first record (sorted desc)
  const currentRecord = records[0];
  const nowOre = dkkMwhToOreKwh(currentRecord.SpotPriceDKK);

  // 24h average
  const avg =
    records.reduce((sum, r) => sum + dkkMwhToOreKwh(r.SpotPriceDKK), 0) / records.length;
  const averageOre = Math.round(avg * 100) / 100;

  let trend: 'up' | 'down' | 'stable';
  const diffPct = Math.abs((nowOre - averageOre) / averageOre);
  if (diffPct < 0.05) {
    trend = 'stable';
  } else if (nowOre > averageOre) {
    trend = 'up';
  } else {
    trend = 'down';
  }

  const result: EnergyPrice = { now: nowOre, average: averageOre, trend };

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

export function clearEnergyCache(): void {
  cache.clear();
}
