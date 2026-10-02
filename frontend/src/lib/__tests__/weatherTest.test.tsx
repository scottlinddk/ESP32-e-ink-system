import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, testWeather } from '../api';
import { createWeatherTest, formatWeatherCoordinates, weatherErrorCode } from '../weatherTest';
import { STRINGS } from '../strings';
import { WeatherTest } from '../../components/dashboard/WeatherTest';
import type { WeatherData } from '../../types';

const session = vi.hoisted(() => ({ userId: 'alice', signedIn: true, lang: 'en' as 'en' | 'da', keysUpdatedAt: 1 }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: session.userId }, isSignedIn: session.signedIn, getToken: async () => 'account-token' }) }));
vi.mock('../../hooks/usePreferences', () => ({ useApiKeys: () => ({ dataUpdatedAt: session.keysUpdatedAt }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[session.lang] }) }));
const weather: WeatherData = { temp: 12.4, condition: 'clear sky', windSpeed: 2.3, icon: '01d' };
beforeEach(() => { session.userId = 'alice'; session.signedIn = true; session.lang = 'en'; session.keysUpdatedAt = 1; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('weather test API and safe diagnostics', () => {
  it('sends only the current coordinates with account auth and cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ weather })));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect(await testWeather('account-token', '57.05, 9.92', signal)).toEqual({ weather });
    expect(fetchMock).toHaveBeenCalledWith('/api/preferences/weather/test', {
      method: 'POST', body: JSON.stringify({ location: '57.05, 9.92' }), signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer account-token' },
    });
  });

  it.each(['missing_key', 'invalid_location', 'invalid_key', 'rate_limited', 'timeout', 'invalid_response', 'unavailable'] as const)(
    'preserves %s and uses translated guidance instead of arbitrary response text', async (code) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, error: 'PRIVATE_PROVIDER_VALUE' }), { status: 502 })));
      const error = await testWeather('account-token', '57.05, 9.92').catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ApiError);
      expect(weatherErrorCode(error)).toBe(code);
      expect(STRINGS.en.weatherErrors[weatherErrorCode(error)]).not.toContain('PRIVATE_PROVIDER_VALUE');
      expect(STRINGS.da.weatherErrors[weatherErrorCode(error)]).not.toContain('PRIVATE_PROVIDER_VALUE');
    },
  );

  it('uses a safe generic message for network failures and unrecognized codes', () => {
    expect(weatherErrorCode(new Error('https://provider.invalid?appid=SECRET'))).toBe('unavailable');
    expect(weatherErrorCode({ code: 'SECRET' })).toBe('unavailable');
  });
});

describe('weather test lifecycle', () => {
  it('reports live success and permits retry after a diagnostic failure', async () => {
    const publish = vi.fn();
    const test = createWeatherTest(publish);
    await test.run(async () => { throw new ApiError(400, 'Missing key', 'missing_key'); });
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', code: 'missing_key' });
    await test.run(async () => weather);
    expect(publish).toHaveBeenLastCalledWith({ status: 'success', weather });
    test.dispose();
  });

  it.each(['resolve', 'reject'] as const)('ignores a late %s when account, coordinates or credentials change', async (finish) => {
    const publish = vi.fn();
    const test = createWeatherTest(publish);
    let resolve!: (value: WeatherData) => void;
    let reject!: (error: unknown) => void;
    let signal!: AbortSignal;
    const pending = test.run((requestSignal) => {
      signal = requestSignal;
      return new Promise((done, fail) => { resolve = done; reject = fail; });
    });
    test.dispose();
    expect(signal.aborted).toBe(true);
    publish.mockClear();
    if (finish === 'resolve') resolve(weather); else reject(new Error('late failure'));
    await pending;
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not let an older test overwrite a newer result', async () => {
    const publish = vi.fn();
    const test = createWeatherTest(publish);
    let complete!: (value: WeatherData) => void;
    const old = test.run(() => new Promise((resolve) => { complete = resolve; }));
    await test.run(async () => weather);
    complete({ ...weather, temp: 99 });
    await old;
    expect(publish).toHaveBeenLastCalledWith({ status: 'success', weather });
    test.dispose();
  });

  it('bounds token and response waits and ignores completion after timeout', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const test = createWeatherTest(publish);
    let complete!: (value: WeatherData) => void;
    let signal!: AbortSignal;
    const pending = test.run((requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => { complete = resolve; });
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal.aborted).toBe(true);
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', code: 'timeout' });
    complete(weather); await pending;
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', code: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('weather setup controls', () => {
  it('explains saved keys and renders the Danish test control', () => {
    const en = renderToStaticMarkup(<WeatherTest location="57.05, 9.92" />);
    expect(en).toContain('Test weather');
    expect(en).toContain('Save key changes first');
    session.lang = 'da';
    const da = renderToStaticMarkup(<WeatherTest location="57.05, 9.92" />);
    expect(da).toContain('Test vejr');
    expect(da).toContain('Gem ændringer af nøglen først');
    session.signedIn = false;
    expect(renderToStaticMarkup(<WeatherTest location="57.05, 9.92" />)).toBe('');
  });

  it('replaces the test instance on each account, coordinate or saved-key change', () => {
    const initial = WeatherTest({ location: '57.05, 9.92' })!.key;
    expect(WeatherTest({ location: '55.68, 12.57' })!.key).not.toBe(initial);
    session.userId = 'bob';
    expect(WeatherTest({ location: '57.05, 9.92' })!.key).not.toBe(initial);
    session.userId = 'alice'; session.keysUpdatedAt = 2;
    expect(WeatherTest({ location: '57.05, 9.92' })!.key).not.toBe(initial);
  });

  it('formats geolocation with decimal dots in both languages and preserves zero coordinates', () => {
    expect(formatWeatherCoordinates(57.0488, 9.9217)).toBe('57.05, 9.92');
    expect(formatWeatherCoordinates(0, 0)).toBe('0.00, 0.00');
    expect(STRINGS.en.locationPh).toBe('57.05, 9.92');
    expect(STRINGS.da.locationPh).toBe('57.05, 9.92');
    expect(() => formatWeatherCoordinates(Number.NaN, 9)).toThrow();
    expect(() => formatWeatherCoordinates(91, 9)).toThrow();
  });
});
