import fetch from 'node-fetch';
import { WeatherData, OpenWeatherResponse, CacheEntry } from '../types/index.js';

const OWM_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, CacheEntry<WeatherData>>();

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

function mapCondition(owmMain: string): string {
  const map: Record<string, string> = {
    Clear: 'clear',
    Clouds: 'cloudy',
    Rain: 'rain',
    Drizzle: 'drizzle',
    Thunderstorm: 'storm',
    Snow: 'snow',
    Mist: 'mist',
    Fog: 'fog',
    Haze: 'haze',
    Dust: 'dust',
    Smoke: 'smoke',
  };
  return map[owmMain] ?? owmMain.toLowerCase();
}

export async function fetchWeather(
  location: string,
  apiKey?: string
): Promise<WeatherData> {
  const key = apiKey ?? process.env.OPENWEATHERMAP_API_KEY;
  if (!key) {
    throw new Error('No OpenWeatherMap API key available');
  }

  const cacheKey = `weather:${location}`;
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  // location is 'lat,lng'
  const [lat, lon] = location.split(',');
  if (!lat || !lon) {
    throw new Error(`Invalid weather_location format: "${location}". Expected "lat,lng"`);
  }

  const url = `${OWM_BASE_URL}?lat=${encodeURIComponent(lat.trim())}&lon=${encodeURIComponent(lon.trim())}&appid=${encodeURIComponent(key)}&units=metric`;

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenWeatherMap API error: ${response.status} — ${body}`);
  }

  const json = (await response.json()) as OpenWeatherResponse;

  const result: WeatherData = {
    temp: Math.round(json.main.temp),
    condition: mapCondition(json.weather[0]?.main ?? 'Unknown'),
    windSpeed: Math.round(json.wind.speed),
    icon: json.weather[0]?.icon ?? '01d',
  };

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

export function clearWeatherCache(): void {
  cache.clear();
}
