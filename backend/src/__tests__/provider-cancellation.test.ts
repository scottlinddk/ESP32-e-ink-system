import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWeatherCache, fetchWeather } from '../services/weather';
import { clearMontaCache, fetchMontaData } from '../services/monta';
import { clearZaptecCache, fetchZaptecData } from '../services/zaptec';
import { clearNotionCache, fetchNotionData } from '../services/notion';

const providers = [
  {
    name: 'weather',
    clear: clearWeatherCache,
    load: (signal: AbortSignal) => fetchWeather('55.3,10.4', 'test-key', signal),
    isData: (_url: string) => true,
    response: (_url: string) => ({ main: { temp: 7 }, weather: [{ main: 'Clouds' }], wind: { speed: 3 } }),
  },
  {
    name: 'Monta',
    clear: clearMontaCache,
    load: (signal: AbortSignal) => fetchMontaData('cancel-test', { clientId: 'test', clientSecret: 'test' }, ['charger_status'], signal),
    isData: (url: string) => url.includes('charge-points'),
    response: (url: string) => url.includes('/auth/token')
      ? { access_token: 'test-token', expires_in: 3600 } : { data: [] },
  },
  {
    name: 'Zaptec',
    clear: clearZaptecCache,
    load: (signal: AbortSignal) => fetchZaptecData('cancel-test', { username: 'test', password: 'test' }, ['charger_status'], signal),
    isData: (url: string) => url.includes('/api/chargers'),
    response: (url: string) => url.includes('/oauth/token')
      ? { access_token: 'test-token', expires_in: 3600 } : { Data: [] },
  },
  {
    name: 'Notion',
    clear: clearNotionCache,
    load: (signal: AbortSignal) => fetchNotionData('cancel-test', { token: 'test', databaseId: 'a'.repeat(32) }, signal),
    isData: (_url: string) => true,
    response: (_url: string) => ({ results: [] }),
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const provider of providers) provider.clear();
});

describe('provider cancellation', () => {
  it.each(providers)('$name forwards cancellation through body reads and does not cache aborted data', async (provider) => {
    provider.clear();
    const controller = new AbortController();
    const error = new Error('Source deadline reached');
    let abortBody = true;
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const readBody = () => {
        if (abortBody && provider.isData(input)) controller.abort(error);
        return provider.response(input);
      };
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => readBody(),
        text: async () => JSON.stringify(readBody()),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(provider.load(controller.signal)).rejects.toThrow('Source deadline reached');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) expect(call[1]?.signal).toBe(controller.signal);

    abortBody = false;
    await expect(provider.load(new AbortController().signal)).resolves.toBeDefined();
    const dataRequests = fetchMock.mock.calls.filter(([url]) => provider.isData(url));
    expect(dataRequests).toHaveLength(2);
  });
});
