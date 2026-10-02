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

// One mounted test owns its request; account/location/key changes dispose it.
export function createWeatherTest(publish: (state: WeatherTestState) => void) {
  let current: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function dispose() { current?.abort(); current = undefined; clearTimeout(timer); }
  return {
    dispose,
    async run(load: (signal: AbortSignal) => Promise<WeatherData>) {
      dispose();
      const request = new AbortController();
      current = request;
      publish({ status: 'loading' });
      timer = setTimeout(() => {
        if (current !== request) return;
        dispose(); publish({ status: 'error', code: 'timeout' });
      }, 15_000);
      try {
        const weather = await load(request.signal);
        if (current === request) publish({ status: 'success', weather });
      } catch (error) {
        if (current === request) publish({ status: 'error', code: weatherErrorCode(error) });
      } finally {
        if (current === request) { clearTimeout(timer); current = undefined; }
      }
    },
  };
}
