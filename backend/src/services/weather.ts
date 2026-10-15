import { createHash } from 'node:crypto';
import type { AirQuality, WeatherData, WeatherForecastSlot, CacheEntry } from '../types/index';
import { normalizeWeatherLocation } from '../utils/weatherLocation';
import { WeatherSourceError } from '../utils/weatherErrors';

const OWM_BASE_URL = 'https://api.openweathermap.org/data/2.5';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
// 40 steps with weather, wind and precipitation come to about 25 KB.
const MAX_FORECAST_BYTES = 256 * 1024;
const cache = new Map<string, CacheEntry<unknown>>();
export const CONDITIONS: Record<string, string> = {
  Clear: 'clear', Clouds: 'cloudy', Rain: 'rain', Drizzle: 'drizzle', Thunderstorm: 'storm',
  Snow: 'snow', Mist: 'mist', Fog: 'fog', Haze: 'haze', Dust: 'dust', Smoke: 'smoke',
  Sand: 'sand', Ash: 'ash', Squall: 'squall', Tornado: 'tornado',
};
const ICON = /^(01|02|03|04|09|10|11|13|50)[dn]$/;

async function readJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw new WeatherSourceError('timeout');
  }
  if (Number(response.headers.get('content-length')) > maxBytes || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new WeatherSourceError('invalid_response');
  }
  const reader = response.body.getReader();
  const cancelBody = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelBody, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new WeatherSourceError('invalid_response');
      }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new WeatherSourceError('invalid_response'); }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** A reading the provider may leave out: kept when it is a number in range, dropped otherwise. */
const optional = (value: unknown, min: number, max: number, round = true): number | undefined =>
  isNumber(value) && value >= min && value <= max ? (round ? Math.round(value) : value) : undefined;
const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

function parseCurrent(json: unknown): WeatherData {
  const data = record(json);
  const main = record(data.main);
  const wind = record(data.wind);
  const first = Array.isArray(data.weather) ? record(data.weather[0]) : {};
  const { temp } = main;
  const speed = wind.speed;
  const condition = first.main;
  const icon = first.icon;
  if (!isNumber(temp) || !isNumber(speed) || speed < 0 || typeof condition !== 'string'
    || !Object.prototype.hasOwnProperty.call(CONDITIONS, condition)
    || typeof icon !== 'string' || !ICON.test(icon)) {
    throw new WeatherSourceError('invalid_response');
  }
  const sys = record(data.sys);
  const rain = record(data.rain)['1h'];
  const snow = record(data.snow)['1h'];
  const precipitation = isNumber(rain) || isNumber(snow)
    ? Math.max(0, (isNumber(rain) ? rain : 0) + (isNumber(snow) ? snow : 0)) : undefined;
  return defined({
    temp: Math.round(temp), condition: CONDITIONS[condition], windSpeed: Math.round(speed), icon,
    feelsLike: optional(main.feels_like, -100, 100),
    humidity: optional(main.humidity, 0, 100),
    pressure: optional(main.pressure, 300, 1100),
    windDeg: optional(wind.deg, 0, 360),
    windGust: optional(wind.gust, 0, 200),
    cloudiness: optional(record(data.clouds).all, 0, 100),
    visibility: optional(data.visibility, 0, 100_000),
    precipitation: precipitation === undefined ? undefined : Math.round(precipitation * 10) / 10,
    sunrise: optional(sys.sunrise, 1, 4_102_444_800),
    sunset: optional(sys.sunset, 1, 4_102_444_800),
  });
}

function parseForecast(json: unknown): WeatherForecastSlot[] {
  const list = record(json).list;
  if (!Array.isArray(list)) throw new WeatherSourceError('invalid_response');
  const slots: WeatherForecastSlot[] = [];
  for (const item of list) {
    const entry = record(item);
    const first = Array.isArray(entry.weather) ? record(entry.weather[0]) : {};
    const temp = record(entry.main).temp;
    const { dt } = entry;
    const { main: condition, icon } = first;
    // One malformed step is skipped, so the rest of the forecast still draws.
    if (!isNumber(dt) || dt <= 0 || !isNumber(temp) || typeof condition !== 'string'
      || !Object.prototype.hasOwnProperty.call(CONDITIONS, condition) || typeof icon !== 'string' || !ICON.test(icon)) continue;
    const rain = record(entry.rain)['3h'];
    const snow = record(entry.snow)['3h'];
    slots.push({
      time: Math.round(dt), temp: Math.round(temp), condition: CONDITIONS[condition], icon,
      pop: Math.round((optional(entry.pop, 0, 1, false) ?? 0) * 100),
      precipitation: Math.round(((isNumber(rain) ? Math.max(0, rain) : 0) + (isNumber(snow) ? Math.max(0, snow) : 0)) * 10) / 10,
    });
  }
  slots.sort((a, b) => a.time - b.time);
  if (slots.length === 0) throw new WeatherSourceError('invalid_response');
  return slots;
}

const tenth = (value: unknown, max: number): number | undefined =>
  isNumber(value) && value >= 0 && value <= max ? Math.round(value * 10) / 10 : undefined;

function parseAirQuality(json: unknown): AirQuality {
  const { list } = record(json);
  const first = record(Array.isArray(list) ? list[0] : undefined);
  const { aqi } = record(first.main);
  if (!isNumber(aqi) || !Number.isInteger(aqi) || aqi < 1 || aqi > 5) throw new WeatherSourceError('invalid_response');
  const components = record(first.components);
  return defined({ aqi: aqi as AirQuality['aqi'], pm25: tenth(components.pm2_5, 10_000), pm10: tenth(components.pm10, 10_000) });
}

interface Request<T> {
  path: string;
  /** Names the kind of reading in the cache, so the three endpoints never share an entry. */
  kind: string;
  extraParams?: Record<string, string>;
  maxBytes: number;
  parse: (json: unknown) => T;
}
interface Options { bypassCache?: boolean }

async function load<T>(request: Request<T>, location: string, apiKey: string | undefined, signal: AbortSignal | undefined, options: Options): Promise<T> {
  if (signal?.aborted) throw new WeatherSourceError('timeout');
  const coordinates = normalizeWeatherLocation(location);
  const key = (apiKey ?? process.env.OPENWEATHERMAP_API_KEY)?.trim();
  if (!key) throw new WeatherSourceError('missing_key');
  const cacheKey = `${request.kind}:${createHash('sha256').update(key).digest('hex')}:${coordinates}`;
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
  if (options.bypassCache) cache.delete(cacheKey);
  const cached = cache.get(cacheKey);
  if (cached) return cached.data as T;

  const [lat, lon] = coordinates.split(',');
  const url = new URL(`${OWM_BASE_URL}/${request.path}`);
  url.search = new URLSearchParams({ lat, lon, appid: key, ...request.extraParams }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort(new WeatherSourceError('timeout'));
  const timer = setTimeout(abort, 10_000);
  signal?.addEventListener('abort', abort, { once: true });
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new WeatherSourceError('timeout')), { once: true });
  });
  try {
    const run = async () => {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new WeatherSourceError(response.status === 401 || response.status === 403 ? 'invalid_key'
          : response.status === 429 ? 'rate_limited' : 'unavailable');
      }
      return request.parse(await readJson(response, controller.signal, request.maxBytes));
    };
    // Includes response-body reads even if an upstream implementation ignores cancellation.
    const result = await Promise.race([run(), cancelled]);
    controller.signal.throwIfAborted();
    cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (error) {
    throw error instanceof WeatherSourceError ? error : new WeatherSourceError('unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const METRIC = { units: 'metric' };

export function fetchWeather(location: string, apiKey?: string, signal?: AbortSignal, options: Options = {}): Promise<WeatherData> {
  return load({ path: 'weather', kind: 'current', extraParams: METRIC, maxBytes: MAX_RESPONSE_BYTES, parse: parseCurrent }, location, apiKey, signal, options);
}

/** The next five days in 3-hour steps, oldest first. Free-tier compatible, unlike One Call. */
export function fetchWeatherForecast(location: string, apiKey?: string, signal?: AbortSignal, options: Options = {}): Promise<WeatherForecastSlot[]> {
  return load({ path: 'forecast', kind: 'forecast', extraParams: METRIC, maxBytes: MAX_FORECAST_BYTES, parse: parseForecast }, location, apiKey, signal, options);
}

export function fetchAirQuality(location: string, apiKey?: string, signal?: AbortSignal, options: Options = {}): Promise<AirQuality> {
  return load({ path: 'air_pollution', kind: 'air', maxBytes: MAX_RESPONSE_BYTES, parse: parseAirQuality }, location, apiKey, signal, options);
}

export function clearWeatherCache(): void { cache.clear(); }
