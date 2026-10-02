import { createHash } from 'node:crypto';
import type { WeatherData, CacheEntry } from '../types/index';
import { normalizeWeatherLocation } from '../utils/weatherLocation';
import { WeatherSourceError } from '../utils/weatherErrors';

const OWM_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const cache = new Map<string, CacheEntry<WeatherData>>();
const CONDITIONS: Record<string, string> = {
  Clear: 'clear', Clouds: 'cloudy', Rain: 'rain', Drizzle: 'drizzle', Thunderstorm: 'storm',
  Snow: 'snow', Mist: 'mist', Fog: 'fog', Haze: 'haze', Dust: 'dust', Smoke: 'smoke',
  Sand: 'sand', Ash: 'ash', Squall: 'squall', Tornado: 'tornado',
};

async function readWeather(response: Response, signal: AbortSignal): Promise<WeatherData> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw new WeatherSourceError('timeout');
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
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
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new WeatherSourceError('invalid_response');
      }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new WeatherSourceError('invalid_response'); }
  const data = json as { main?: { temp?: unknown }; wind?: { speed?: unknown }; weather?: Array<{ main?: unknown; icon?: unknown }> } | null;
  const temp = data?.main?.temp;
  const speed = data?.wind?.speed;
  const condition = Array.isArray(data?.weather) ? data.weather[0]?.main : undefined;
  const icon = Array.isArray(data?.weather) ? data.weather[0]?.icon : undefined;
  if (typeof temp !== 'number' || !Number.isFinite(temp) || typeof speed !== 'number'
    || !Number.isFinite(speed) || speed < 0 || typeof condition !== 'string' || !Object.prototype.hasOwnProperty.call(CONDITIONS, condition)
    || typeof icon !== 'string' || !/^(01|02|03|04|09|10|11|13|50)[dn]$/.test(icon)) {
    throw new WeatherSourceError('invalid_response');
  }
  return { temp: Math.round(temp), condition: CONDITIONS[condition], windSpeed: Math.round(speed), icon };
}

export async function fetchWeather(
  location: string,
  apiKey?: string,
  signal?: AbortSignal,
  options: { bypassCache?: boolean } = {},
): Promise<WeatherData> {
  if (signal?.aborted) throw new WeatherSourceError('timeout');
  const coordinates = normalizeWeatherLocation(location);
  const key = (apiKey ?? process.env.OPENWEATHERMAP_API_KEY)?.trim();
  if (!key) throw new WeatherSourceError('missing_key');
  const cacheKey = `${createHash('sha256').update(key).digest('hex')}:${coordinates}`;
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
  if (options.bypassCache) cache.delete(cacheKey);
  const cached = cache.get(cacheKey);
  if (cached) return cached.data;

  const [lat, lon] = coordinates.split(',');
  const url = new URL(OWM_BASE_URL);
  url.search = new URLSearchParams({ lat, lon, appid: key, units: 'metric' }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort(new WeatherSourceError('timeout'));
  const timer = setTimeout(abort, 10_000);
  signal?.addEventListener('abort', abort, { once: true });
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new WeatherSourceError('timeout')), { once: true });
  });
  try {
    const load = async () => {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new WeatherSourceError(response.status === 401 || response.status === 403 ? 'invalid_key'
          : response.status === 429 ? 'rate_limited' : 'unavailable');
      }
      return readWeather(response, controller.signal);
    };
    // Includes response-body reads even if an upstream implementation ignores cancellation.
    const result = await Promise.race([load(), cancelled]);
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

export function clearWeatherCache(): void { cache.clear(); }
