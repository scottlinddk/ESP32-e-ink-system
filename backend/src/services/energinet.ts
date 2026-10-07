import { EnergyPrice, EnergyPriceHour, CacheEntry } from '../types/index';
import { EnergyPriceSettings, parseEnergyPriceSettings } from '../utils/energyPriceSettings';
import { fetchDanishDaySpot, SpotInterval } from './elprisenligenu';
import { EnergyPriceSourceError } from '../utils/energyPriceErrors';

const BASE_URL = 'https://api.energidataservice.dk/dataset/';
const NATIONAL_GLN = '5790000432752';
const NATIONAL_CODES = ['40000', '41000', 'EA-001']; // Transmission, system, standard electricity tax.
interface TariffRecord {
  GLN_Number: string; ChargeType: string; ChargeTypeCode: string;
  ValidFrom: string; ValidTo: string | null; ResolutionDuration: string;
  [key: string]: unknown;
}
const spotCache = new Map<string, CacheEntry<SpotInterval[]>>();
const pendingSpot = new Map<string, Promise<SpotInterval[]>>();
const tariffCache = new Map<string, { day: string; records: TariffRecord[] }>();
const pendingTariffs = new Map<string, Promise<TariffRecord[]>>();
const danishDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});
const danishHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23',
});

async function request(dataset: string, params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch(`${BASE_URL}${dataset}?${params}`, {
    headers: { Accept: 'application/json' }, signal,
  });
  if (!response.ok) throw new Error(`Energinet API error: ${response.status} ${response.statusText}`);
  const json = await response.json();
  signal.throwIfAborted();
  return json;
}

async function loadSpot(priceArea: string, signal: AbortSignal): Promise<SpotInterval[]> {
  // Spot prices come from Elprisen lige nu; tariffs below still come from Energinet's DataHub.
  const now = Date.now();
  const records = await fetchDanishDaySpot(priceArea, now, signal);
  const current = records.find((r) => r.start <= now && now < r.end);
  if (!current) throw new Error('No energy price available for the current interval');
  // Cache source intervals, never a user's calculated price or previous interval.
  spotCache.set(priceArea, { data: records, expiresAt: current.end });
  return records;
}

async function fetchSpot(priceArea: string): Promise<SpotInterval[]> {
  const cached = spotCache.get(priceArea);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const inFlight = pendingSpot.get(priceArea);
  if (inFlight) return inFlight;
  // Public shared requests must outlive an individual caller's cancellation.
  const promise = loadSpot(priceArea, AbortSignal.timeout(10_000));
  pendingSpot.set(priceArea, promise);
  try { return await promise; } finally { pendingSpot.delete(priceArea); }
}

function tariffTotal(records: TariffRecord[], gln: string, codes: string[], instant: number): number {
  const day = danishDate.format(instant);
  const hour = Number(danishHour.format(instant));
  // ValidTo is exclusive; validity fields are Danish dates, not UTC instants.
  const active = codes.map((code) => records.filter((r) => r.ChargeTypeCode === code
    && r.ValidFrom.slice(0, 10) <= day && (r.ValidTo === null || day < r.ValidTo.slice(0, 10)))
    .sort((a, b) => b.ValidFrom.localeCompare(a.ValidFrom))[0]);
  // Report every missing code at once so a GLN/code mismatch is fixed in one attempt.
  const missing = codes.filter((_, index) => !active[index]);
  if (missing.length) throw new EnergyPriceSourceError('missing_tariff', missing, gln);
  return active.reduce((sum, tariff) => {
    if (!['P1D', 'PT1H'].includes(tariff.ResolutionDuration)) throw new EnergyPriceSourceError('invalid_response');
    // A null hourly slot uses Price1; zero and negative tariffs remain valid.
    const price = tariff.ResolutionDuration === 'P1D' ? tariff.Price1 : tariff[`Price${hour + 1}`] ?? tariff.Price1;
    if (typeof price !== 'number' || !Number.isFinite(price)) throw new EnergyPriceSourceError('invalid_response');
    return sum + price * 100; // Published DKK/kWh excluding VAT -> øre/kWh.
  }, 0);
}

async function fetchTariffs(gln: string, codes: string[]): Promise<TariffRecord[]> {
  const day = danishDate.format(Date.now());
  const key = JSON.stringify([gln, [...codes].sort()]);
  const cached = tariffCache.get(key);
  if (cached?.day === day) return cached.records;
  const pendingKey = day + key;
  const inFlight = pendingTariffs.get(pendingKey);
  if (inFlight) return inFlight;
  const promise = (async () => {
    // A recent start or small limit drops older prices that are still effective.
    const params = new URLSearchParams({
      end: 'StartOfDay+P1D', limit: '0', sort: 'ValidFrom DESC',
      filter: JSON.stringify({ GLN_Number: [gln], ChargeType: ['D03'], ChargeTypeCode: codes.map((code) => code.replace(/'/g, "''")) }),
      columns: ['GLN_Number', 'ChargeType', 'ChargeTypeCode', 'ValidFrom', 'ValidTo', 'ResolutionDuration',
        ...Array.from({ length: 24 }, (_, index) => `Price${index + 1}`)].join(','),
    });
    const json = await request('DatahubPricelist', params, AbortSignal.timeout(10_000)) as { records?: TariffRecord[] };
    const dateField = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?)?$/;
    const records: TariffRecord[] = (Array.isArray(json.records) ? json.records : [])
      .filter((r: TariffRecord) => r && r.GLN_Number === gln && r.ChargeType === 'D03'
        && codes.includes(r.ChargeTypeCode) && typeof r.ValidFrom === 'string' && dateField.test(r.ValidFrom)
        && (r.ValidTo === null || typeof r.ValidTo === 'string' && dateField.test(r.ValidTo)));
    tariffTotal(records, gln, codes, Date.now()); // Never cache a missing/invalid required charge.
    for (const [oldKey, entry] of tariffCache) if (entry.day !== day) tariffCache.delete(oldKey);
    tariffCache.set(key, { day, records });
    return records;
  })();
  pendingTariffs.set(pendingKey, promise);
  try { return await promise; } finally { pendingTariffs.delete(pendingKey); }
}

const HOUR_MS = 3_600_000;

/**
 * Hourly means of the day's intervals. Danish UTC offsets are whole hours, so a UTC hour
 * is a Danish hour, and both repeated autumn hours stay separate.
 */
export function hourlyPrices(records: SpotInterval[]): EnergyPriceHour[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const record of records) {
    const start = Math.floor(record.start / HOUR_MS) * HOUR_MS;
    const bucket = buckets.get(start) ?? { sum: 0, count: 0 };
    bucket.sum += record.price;
    bucket.count += 1;
    buckets.set(start, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([start, { sum, count }]) => ({
    start: new Date(start).toISOString(),
    hour: Number(danishHour.format(start)),
    price: Math.round((sum / count) * 100) / 100,
  }));
}

export async function fetchEnergyPrice(
  priceArea: string = 'DK1', signal?: AbortSignal, input: EnergyPriceSettings = { mode: 'spot' },
): Promise<EnergyPrice> {
  const requestSignal = signal ?? AbortSignal.timeout(10_000);
  requestSignal.throwIfAborted();
  if (priceArea !== 'DK1' && priceArea !== 'DK2') throw new EnergyPriceSourceError('invalid_settings');
  let settings: EnergyPriceSettings;
  try { settings = parseEnergyPriceSettings(input); } catch { throw new EnergyPriceSourceError('invalid_settings'); }
  const [spot, national, grid] = await Promise.all([
    fetchSpot(priceArea),
    // Missing national charges are Energinet's gap, not the user's tariff codes; the codes stay for logs.
    settings.mode === 'consumer' ? fetchTariffs(NATIONAL_GLN, NATIONAL_CODES).catch((error: unknown) => {
      throw error instanceof EnergyPriceSourceError && error.code === 'missing_tariff'
        ? new EnergyPriceSourceError('unavailable', error.missingCodes) : error;
    }) : [],
    settings.mode === 'consumer' ? fetchTariffs(settings.gridGln, settings.gridChargeCodes) : [],
  ]);
  requestSignal.throwIfAborted();
  // Apply the tariff at each interval's Danish hour, including both repeated autumn hours.
  const records = spot.map((r) => ({ ...r, price: settings.mode === 'consumer'
    ? (r.price + tariffTotal(national, NATIONAL_GLN, NATIONAL_CODES, r.start)
      + tariffTotal(grid, settings.gridGln, settings.gridChargeCodes, r.start) + settings.retailerMarkupOre) * 1.25
    : r.price }));
  const now = Date.now();
  const current = records.find((r) => r.start <= now && now < r.end);
  if (!current) throw new Error('No energy price available for the current interval');
  const average = records.reduce((sum, r) => sum + r.price, 0) / records.length;
  const difference = current.price - average;
  return {
    now: Math.round(current.price * 100) / 100,
    average: Math.round(average * 100) / 100,
    ...(settings.mode === 'consumer' ? { basis: 'consumer' as const } : {}),
    trend: Math.abs(difference) <= Math.max(Math.abs(average) * 0.05, 0.01)
      ? 'stable' : difference > 0 ? 'up' : 'down',
    hours: hourlyPrices(records),
  };
}

export function clearEnergyCache(): void {
  spotCache.clear();
  tariffCache.clear();
  pendingSpot.clear();
  pendingTariffs.clear();
}
