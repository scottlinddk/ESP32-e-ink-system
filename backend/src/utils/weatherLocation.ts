import { WeatherSourceError } from './weatherErrors';

/** Shared by saved preferences, portable templates and live provider requests. */
export function normalizeWeatherLocation(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) throw new WeatherSourceError('invalid_location');
  const parts = value.split(',').map((part) => part.trim());
  const decimal = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (parts.length !== 2 || !parts.every((part) => decimal.test(part))) {
    throw new WeatherSourceError('invalid_location');
  }
  const [latitude, longitude] = parts.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new WeatherSourceError('invalid_location');
  }
  return `${latitude},${longitude}`;
}
