import { EnergyPrice, EnergidataResponse, CacheEntry } from '../types/index';

const ENERGINET_BASE_URL = 'https://api.energidataservice.dk/dataset/DayAheadPrices';
const INTERVAL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry<EnergyPrice>>();
const pending = new Map<string, Promise<EnergyPrice>>();
const danishDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

async function loadEnergyPrice(priceArea: string, signal?: AbortSignal): Promise<EnergyPrice> {
  const requestSignal = signal ?? AbortSignal.timeout(10_000);
  // The API interprets these bounds in Danish local time, including 23/25-hour days.
  const params = new URLSearchParams({
    start: 'StartOfDay', end: 'StartOfDay+P1D', limit: '100',
    filter: JSON.stringify({ PriceArea: [priceArea] }), sort: 'TimeUTC asc',
  });
  const response = await fetch(`${ENERGINET_BASE_URL}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`Energinet API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as EnergidataResponse;
  requestSignal.throwIfAborted();
  const now = Date.now();
  const today = danishDate.format(now);
  const records = (Array.isArray(json.records) ? json.records : [])
    .filter((r) => r && r.PriceArea === priceArea
      && typeof r.TimeUTC === 'string' && Number.isFinite(r.DayAheadPriceDKK))
    .map((r) => ({
      // Energinet's UTC column deliberately omits the Z suffix.
      start: Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(r.TimeUTC) ? r.TimeUTC : `${r.TimeUTC}Z`),
      price: r.DayAheadPriceDKK / 10, // DKK/MWh -> øre/kWh; spot only, no tax/tariffs.
    }))
    .filter((r) => Number.isFinite(r.start) && danishDate.format(r.start) === today);

  const current = records.find((r) => r.start <= now && now < r.start + INTERVAL_MS);
  if (!current) {
    throw new Error('No energy price available for the current 15-minute interval');
  }
  const average = records.reduce((sum, r) => sum + r.price, 0) / records.length;
  const difference = current.price - average;
  const result: EnergyPrice = {
    now: roundPrice(current.price),
    average: roundPrice(average),
    // A zero or negative daily average is valid on the spot market.
    trend: Math.abs(difference) <= Math.max(Math.abs(average) * 0.05, 0.01)
      ? 'stable' : difference > 0 ? 'up' : 'down',
  };

  // Never serve the previous interval's price after a quarter-hour boundary.
  cache.set(priceArea, { data: result, expiresAt: current.start + INTERVAL_MS });
  return result;
}

export async function fetchEnergyPrice(priceArea: string = 'DK1', signal?: AbortSignal): Promise<EnergyPrice> {
  signal?.throwIfAborted();
  if (priceArea !== 'DK1' && priceArea !== 'DK2') {
    throw new Error('Energy price area must be DK1 or DK2');
  }
  const cached = cache.get(priceArea);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  // Simultaneous JSON/image requests share one upstream request per area.
  const inFlight = pending.get(priceArea);
  if (inFlight) return inFlight;
  const request = loadEnergyPrice(priceArea, signal);
  pending.set(priceArea, request);
  try {
    return await request;
  } finally {
    pending.delete(priceArea);
  }
}

export function clearEnergyCache(): void {
  cache.clear();
}
