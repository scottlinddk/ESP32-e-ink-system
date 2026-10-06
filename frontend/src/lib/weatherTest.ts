import { createSourceTest } from './sourceTest';
import type { WeatherData, WeatherErrorCode } from '../types';

export type WeatherTestState = { status: 'idle' | 'loading' }
  | { status: 'success'; weather: WeatherData }
  | { status: 'error'; code: WeatherErrorCode };

export function weatherErrorCode(error: unknown): WeatherErrorCode {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && ['missing_key', 'invalid_location', 'invalid_key', 'rate_limited', 'timeout', 'invalid_response'].includes(code)
    ? code as WeatherErrorCode : 'unavailable';
}

export function formatWeatherCoordinates(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Invalid coordinates');
  }
  return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
}

export function createWeatherTest(publish: (state: WeatherTestState) => void) {
  return createSourceTest<WeatherData, WeatherTestState>(publish, {
    success: (weather) => ({ status: 'success', weather }),
    error: (error) => ({ status: 'error', code: weatherErrorCode(error) }),
    timeout: { status: 'error', code: 'timeout' },
  });
}
