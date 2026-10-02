import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getApiKeys, getPreferences, upsertPreferences } from '../services/database';
import { fetchWeather } from '../services/weather';
import { WeatherSourceError } from '../utils/weatherErrors';
import { parseDisplayTemplate } from '../utils/displayTemplates';
import router from '../routes/preferences';
import type { ApiKey, WeatherErrorCode } from '../types';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.headers.authorization) { res.status(401).json({ error: 'Sign-in required' }); return; }
  req.clerkUserId = 'clerk-owner'; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
vi.mock('../services/weather', () => ({ fetchWeather: vi.fn() }));

describe('weather settings and live setup check', () => {
  let server: Server;
  let base: string;
  const weather = { temp: 7, condition: 'cloudy', windSpeed: 3, icon: '04d' };
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPreferences).mockResolvedValue(null);
    vi.mocked(getApiKeys).mockResolvedValue([{ provider: 'openweathermap', api_key: 'saved-owner-key' } as ApiKey]);
    vi.mocked(fetchWeather).mockResolvedValue(weather);
  });
  const post = (path: string, body: unknown, authorized = true) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify(body) });

  it('tests draft coordinates with the current owner key, bypasses cache, and saves no preferences', async () => {
    const response = await post('/weather/test', { location: ' +57.050,009.920 ', api_key: 'injected-key', user_id: 'other-user' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ weather });
    expect(getApiKeys).toHaveBeenCalledWith('owner');
    expect(fetchWeather).toHaveBeenCalledWith('57.05,9.92', 'saved-owner-key', undefined, { bypassCache: true });
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it('allows the existing server fallback when no owner key is saved', async () => {
    vi.mocked(getApiKeys).mockResolvedValue([]);
    expect((await post('/weather/test', { location: '0,0' })).status).toBe(200);
    expect(fetchWeather).toHaveBeenCalledWith('0,0', undefined, undefined, { bypassCache: true });
  });

  it('requires sign-in before reading credentials or contacting the provider', async () => {
    expect((await post('/weather/test', { location: '0,0' }, false)).status).toBe(401);
    expect(getApiKeys).not.toHaveBeenCalled();
    expect(fetchWeather).not.toHaveBeenCalled();
  });

  it.each([
    ['missing_key', 400], ['invalid_key', 400], ['rate_limited', 502],
    ['unavailable', 502], ['invalid_response', 502], ['timeout', 504],
  ] as Array<[WeatherErrorCode, number]>)('returns a safe %s diagnostic with HTTP %s', async (code, status) => {
    const error = new WeatherSourceError(code);
    vi.mocked(fetchWeather).mockRejectedValueOnce(error);
    const response = await post('/weather/test', { location: '0,0' });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, error: error.message });
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it.each([null, '', ',0', '55,40,10,40', '91,0', '0,-181', '1e2,0', '1,2,3'])('rejects invalid %j consistently and atomically', async (location) => {
    const test = await post('/weather/test', { location });
    expect(test.status).toBe(400);
    expect(await test.json()).toMatchObject({ code: 'invalid_location' });
    expect((await post('', { show_weather: true, weather_location: location })).status).toBe(400);
    expect(() => parseDisplayTemplate({ format: 'esp32-eink-template', version: 1, settings: { weather_location: location } })).toThrow();
    expect(upsertPreferences).not.toHaveBeenCalled();
    expect(fetchWeather).not.toHaveBeenCalled();
    expect(getApiKeys).not.toHaveBeenCalled();
  });

  it('normalizes valid saved coordinates and portable templates, including zero', async () => {
    expect((await post('', { weather_location: ' -0, +0.000 ' })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', { weather_location: '0,0' });
    expect(parseDisplayTemplate({ format: 'esp32-eink-template', version: 1, settings: { weather_location: ' +57.050, 9.920 ' } }).settings.weather_location).toBe('57.05,9.92');
  });
});
