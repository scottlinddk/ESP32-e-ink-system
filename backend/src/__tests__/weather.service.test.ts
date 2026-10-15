import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWeatherCache, fetchAirQuality, fetchWeather, fetchWeatherForecast } from '../services/weather';
import { normalizeWeatherLocation } from '../utils/weatherLocation';

const valid = { main: { temp: 7.4 }, weather: [{ main: 'Clouds', icon: '04d' }], wind: { speed: 2.7 } };
const response = (body: unknown = valid, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn<[URL, RequestInit?], Promise<Response>>();

beforeEach(() => {
  clearWeatherCache();
  vi.stubEnv('OPENWEATHERMAP_API_KEY', '');
  fetchMock.mockReset().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { clearWeatherCache(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('OpenWeatherMap current weather', () => {
  it('fetches valid metric weather with canonical coordinates and caches only the matching credential', async () => {
    expect(await fetchWeather(' +57.050, 009.920 ', ' key-a ')).toEqual({ temp: 7, condition: 'cloudy', windSpeed: 3, icon: '04d' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.openweathermap.org/data/2.5/weather');
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '57.05', lon: '9.92', appid: 'key-a', units: 'metric' });
    await fetchWeather('57.05,9.92', 'key-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ ...valid, main: { temp: -2 } }));
    expect((await fetchWeather('57.05,9.92', 'key-b')).temp).toBe(-2);
    await fetchWeather('0,0', 'key-a');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the server key only when no user key exists, and invalid user credentials never fall back', async () => {
    vi.stubEnv('OPENWEATHERMAP_API_KEY', 'server-key');
    await fetchWeather('0,0');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('appid')).toBe('server-key');
    fetchMock.mockResolvedValueOnce(response({ message: 'secret key error' }, 401));
    await expect(fetchWeather('0,0', 'bad-user-key')).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bypasses and evicts an earlier success for a live test, and does not cache rejected data', async () => {
    await fetchWeather('0,0', 'key');
    fetchMock.mockResolvedValueOnce(response({ message: 'revoked' }, 401));
    await expect(fetchWeather('0,0', 'key', undefined, { bypassCache: true })).rejects.toMatchObject({ code: 'invalid_key' });
    fetchMock.mockResolvedValueOnce(response({ ...valid, main: { temp: 0 }, wind: { speed: 0 } }));
    expect(await fetchWeather('0,0', 'key')).toMatchObject({ temp: 0, windSpeed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('expires successful weather after one hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    await fetchWeather('0,0', 'key');
    vi.setSystemTime(new Date('2026-10-02T10:59:59Z'));
    await fetchWeather('0,0', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-02T11:00:00Z'));
    await fetchWeather('0,0', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing key without sending coordinates to the provider', async () => {
    await expect(fetchWeather('0,0')).rejects.toMatchObject({ code: 'missing_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'invalid_key'], [403, 'invalid_key'], [429, 'rate_limited'], [500, 'unavailable'],
  ])('sanitizes HTTP %s without exposing provider content or credentials', async (status, code) => {
    const text = 'SECRET https://api.openweathermap.org/?appid=SECRET';
    fetchMock.mockResolvedValueOnce(response({ message: text }, status as number));
    const error = await fetchWeather('0,0', 'SECRET').catch((caught: Error) => caught);
    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain('SECRET');
    expect(String(error)).not.toContain('SECRET');
    if (status === 401) expect(String(error)).toContain('2 hours');
  });

  it('sanitizes network failures instead of returning a URL-bearing exception', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch https://api.openweathermap.org/?appid=SECRET failed'));
    await expect(fetchWeather('0,0', 'SECRET')).rejects.toMatchObject({ code: 'unavailable', message: 'OpenWeatherMap is unavailable. Try again later.' });
  });

  it.each([
    null, {}, { ...valid, main: { temp: null } }, { ...valid, main: { temp: '7' } },
    { ...valid, wind: { speed: -1 } }, { ...valid, weather: [] },
    { ...valid, weather: [{ main: 'SECRET', icon: '04d' }] },
    { ...valid, weather: [{ main: 'Clouds', icon: 'https://SECRET' }] },
  ].map((body) => ({ body })))('rejects malformed weather $body', async ({ body }) => {
    fetchMock.mockResolvedValueOnce(response(body));
    await expect(fetchWeather('0,0', 'key')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects invalid JSON and oversized bodies, including streaming bodies without Content-Length', async () => {
    for (const bad of [new Response('{SECRET'), new Response('x'.repeat(65_537)),
      new Response('{}', { headers: { 'content-length': '65537' } })]) {
      fetchMock.mockResolvedValueOnce(bad);
      await expect(fetchWeather('0,0', 'key')).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });

  it.each(['fetch', 'body'])('bounds a stalled %s and never caches late results', async (stage) => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const cancel = vi.fn();
    if (stage === 'fetch') fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    else fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const pending = fetchWeather('0,0', 'key');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    if (stage === 'fetch') finish(response({ ...valid, main: { temp: 99 } }));
    else expect(cancel).toHaveBeenCalled();
    await Promise.resolve();
    expect((await fetchWeather('0,0', 'key')).temp).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors an external cancellation while reading the body', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream()));
    const pending = fetchWeather('0,0', 'key', controller.signal);
    controller.abort(new Error('private cancellation message'));
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect((await fetchWeather('0,0', 'key')).temp).toBe(7);
  });
});

describe('weather coordinate validation', () => {
  it.each([['0,0', '0,0'], [' -90, +180 ', '-90,180'], ['+.5,-.25', '0.5,-0.25'], ['-0,00', '0,0']])(
    'normalizes %s to %s', (value, expected) => expect(normalizeWeatherLocation(value)).toBe(expected));
  it.each([null, 0, [], {}, '', ' ', ',0', '0,', '0,0,0', '55,40, 10,40', '91,0', '0,-181',
    'NaN,0', 'Infinity,0', '0x20,0', '5e1,0', '0,0secret', `${'0'.repeat(64)},0`])(
    'rejects invalid coordinates %j', (value) => expect(() => normalizeWeatherLocation(value)).toThrow());
});

describe('extra current readings', () => {
  const full = {
    ...valid,
    main: { temp: 7.4, feels_like: 5.2, humidity: 81, pressure: 1013 },
    wind: { speed: 2.7, deg: 250, gust: 6.4 },
    clouds: { all: 75 }, visibility: 9000, rain: { '1h': 0.26 }, snow: { '1h': 0.1 },
    sys: { sunrise: 1_790_000_000, sunset: 1_790_040_000 },
  };

  it('keeps every reading the provider reports, rounded and typed', async () => {
    fetchMock.mockResolvedValueOnce(response(full));
    expect(await fetchWeather('0,0', 'key')).toEqual({
      temp: 7, condition: 'cloudy', windSpeed: 3, icon: '04d', feelsLike: 5, humidity: 81, pressure: 1013,
      windDeg: 250, windGust: 6, cloudiness: 75, visibility: 9000, precipitation: 0.4,
      sunrise: 1_790_000_000, sunset: 1_790_040_000,
    });
  });

  it('leaves out readings that are absent, out of range or of the wrong type instead of failing', async () => {
    fetchMock.mockResolvedValueOnce(response({
      ...valid, main: { temp: 7, feels_like: 'warm', humidity: 140, pressure: 5 }, wind: { speed: 2, deg: -5, gust: null },
      clouds: { all: 'many' }, visibility: -1, rain: { '1h': 'wet' }, sys: { sunrise: 0 },
    }));
    const weather = await fetchWeather('0,0', 'key');
    expect(weather).toEqual({ temp: 7, condition: 'cloudy', windSpeed: 2, icon: '04d' });
    expect(Object.keys(weather)).not.toContain('humidity');
  });
});

describe('OpenWeatherMap forecast', () => {
  const step = (dt: number, extra: Record<string, unknown> = {}) => ({
    dt, main: { temp: 10.6 }, weather: [{ main: 'Rain', icon: '10d' }], pop: 0.456, rain: { '3h': 1.24 }, ...extra,
  });
  const forecast = (...list: unknown[]) => response({ list });

  it('requests the 5-day forecast in metric units and returns ordered, rounded steps', async () => {
    fetchMock.mockResolvedValueOnce(forecast(step(1_790_010_800), step(1_790_000_000, { pop: 1, rain: undefined, snow: { '3h': 0.04 } })));
    expect(await fetchWeatherForecast(' 57.050, 9.92 ', 'key')).toEqual([
      { time: 1_790_000_000, temp: 11, condition: 'rain', icon: '10d', pop: 100, precipitation: 0 },
      { time: 1_790_010_800, temp: 11, condition: 'rain', icon: '10d', pop: 46, precipitation: 1.2 },
    ]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.openweathermap.org/data/2.5/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '57.05', lon: '9.92', appid: 'key', units: 'metric' });
  });

  it('skips a malformed step but keeps the rest, and rejects a forecast with nothing usable', async () => {
    fetchMock.mockResolvedValueOnce(forecast(step(1_790_000_000), step(0), { dt: 5 }, step(1_790_010_800, { weather: [{ main: 'Nope', icon: '10d' }] }), null, 'x'));
    expect(await fetchWeatherForecast('0,0', 'key')).toHaveLength(1);
    for (const body of [{ list: [] }, { list: [{ dt: 1 }] }, { list: 'x' }, {}, null]) {
      fetchMock.mockResolvedValueOnce(response(body));
      await expect(fetchWeatherForecast('0,0', 'other')).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });

  it('caches per kind, so the current reading, forecast and air quality never share an entry', async () => {
    await fetchWeather('0,0', 'key');
    fetchMock.mockResolvedValueOnce(forecast(step(1_790_000_000)));
    await fetchWeatherForecast('0,0', 'key');
    await fetchWeatherForecast('0,0', 'key');
    await fetchWeather('0,0', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/weather?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/forecast?');
  });

  it('shares the credential rules: a missing key sends nothing, errors are sanitized', async () => {
    await expect(fetchWeatherForecast('0,0')).rejects.toMatchObject({ code: 'missing_key' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(response({ message: 'SECRET' }, 429));
    const error = await fetchWeatherForecast('0,0', 'SECRET').catch((caught: Error) => caught);
    expect(error).toMatchObject({ code: 'rate_limited' });
    expect(String(error)).not.toContain('SECRET');
  });

  it('accepts a body well over the current weather limit, but not an unbounded one', async () => {
    const big = Array.from({ length: 40 }, (_, i) => step(1_790_000_000 + i * 10_800, { padding: 'x'.repeat(2000) }));
    fetchMock.mockResolvedValueOnce(forecast(...big));
    expect(await fetchWeatherForecast('0,0', 'key')).toHaveLength(40);
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(262_145)));
    await expect(fetchWeatherForecast('0,0', 'big')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('OpenWeatherMap air quality', () => {
  const air = (list: unknown) => response({ list });

  it('returns the index and particle readings', async () => {
    fetchMock.mockResolvedValueOnce(air([{ main: { aqi: 2 }, components: { pm2_5: 4.249, pm10: 7.44, co: 200 } }]));
    expect(await fetchAirQuality('57.05,9.92', 'key')).toEqual({ aqi: 2, pm25: 4.2, pm10: 7.4 });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.openweathermap.org/data/2.5/air_pollution');
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '57.05', lon: '9.92', appid: 'key' });
  });

  it('keeps the index when a particle reading is missing, and rejects an index outside 1 to 5', async () => {
    fetchMock.mockResolvedValueOnce(air([{ main: { aqi: 5 }, components: { pm2_5: 'x', pm10: -3 } }]));
    expect(await fetchAirQuality('0,0', 'key')).toEqual({ aqi: 5 });
    for (const list of [[{ main: { aqi: 0 } }], [{ main: { aqi: 6 } }], [{ main: { aqi: 2.5 } }], [{}], [], 'x']) {
      fetchMock.mockResolvedValueOnce(air(list));
      await expect(fetchAirQuality('0,0', 'bad')).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });
});
