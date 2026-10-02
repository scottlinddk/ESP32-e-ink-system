import type { WeatherErrorCode, WeatherProblem } from '../types';

const MESSAGES: Record<WeatherErrorCode, string> = {
  missing_key: 'Save an OpenWeatherMap API key before testing weather.',
  invalid_location: 'Use latitude,longitude with decimal points, for example 57.05,9.92. Latitude must be -90 to 90 and longitude -180 to 180.',
  invalid_key: 'OpenWeatherMap rejected the API key. Check the saved key and Current Weather access. New keys can take up to 2 hours to activate.',
  rate_limited: 'OpenWeatherMap request limit reached. Check your plan quota and try again later.',
  unavailable: 'OpenWeatherMap is unavailable. Try again later.',
  timeout: 'OpenWeatherMap did not respond in time. Try again.',
  invalid_response: 'OpenWeatherMap returned incomplete or invalid weather data. Try again later.',
};

export const WEATHER_ERROR_LABELS: Record<WeatherErrorCode, string> = {
  missing_key: 'Add API key', invalid_location: 'Check location', invalid_key: 'Check API key',
  rate_limited: 'API limit', unavailable: 'Unavailable', timeout: 'Timed out', invalid_response: 'Invalid data',
};

/** Only fixed messages may leave the provider boundary; never include a URL or response body. */
export class WeatherSourceError extends Error {
  constructor(readonly code: WeatherErrorCode) {
    super(MESSAGES[code]);
    this.name = 'WeatherSourceError';
  }
}

export function weatherProblem(error: unknown): WeatherProblem {
  const code = error instanceof WeatherSourceError ? error.code
    : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout'
    : 'unavailable';
  return { code, message: MESSAGES[code] };
}
