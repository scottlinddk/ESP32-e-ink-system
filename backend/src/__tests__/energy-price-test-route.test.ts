import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { upsertPreferences } from '../services/database';
import { fetchEnergyPrice } from '../services/energinet';
import { EnergyPriceSourceError } from '../utils/energyPriceErrors';
import router from '../routes/preferences';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.headers.authorization) { res.status(401).json({ error: 'Sign-in required' }); return; }
  req.clerkUserId = 'clerk-owner'; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
vi.mock('../services/energinet', () => ({ fetchEnergyPrice: vi.fn() }));

describe('energy price draft test', () => {
  let server: Server;
  let base: string;
  const settings = { mode: 'consumer', gridGln: '5790000611003', gridChargeCodes: ['CD', 'CD R'], retailerMarkupOre: 10 };
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { vi.clearAllMocks(); });
  const post = (body: unknown, authorized = true) => fetch(`${base}/energy-price/test`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify(body) });

  it('prices the draft settings without saving them', async () => {
    const price = { now: 210.5, average: 190, trend: 'up', basis: 'consumer' };
    vi.mocked(fetchEnergyPrice).mockResolvedValue(price as never);
    const response = await post({ location: 'DK1', settings });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ price });
    expect(fetchEnergyPrice).toHaveBeenCalledWith('DK1', undefined, settings);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });

  it('names every tariff code missing for the configured GLN', async () => {
    vi.mocked(fetchEnergyPrice).mockRejectedValue(new EnergyPriceSourceError('missing_tariff', ['CD', 'CD R'], '5790000611003'));
    const response = await post({ location: 'DK1', settings });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'missing_tariff', missingCodes: ['CD', 'CD R'],
      error: expect.stringContaining('No current tariff for CD, CD R at grid company GLN 5790000611003') });
  });

  it.each([
    [new EnergyPriceSourceError('invalid_settings'), 400, 'invalid_settings'],
    [new EnergyPriceSourceError('invalid_response'), 502, 'invalid_response'],
    [new Error('Energinet API error: 500 https://upstream.example/secret'), 502, 'unavailable'],
    [Object.assign(new Error('late'), { name: 'TimeoutError' }), 504, 'timeout'],
  ])('maps %s to a fixed public response', async (error, status, code) => {
    vi.mocked(fetchEnergyPrice).mockRejectedValue(error);
    const response = await post({ location: 'DK1', settings });
    expect(response.status).toBe(status);
    const body = await response.json() as { code: string };
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain('upstream.example');
  });

  it.each([{ settings }, { location: 'DK1' }])('requires both draft fields: %j', async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe('invalid_settings');
    expect(fetchEnergyPrice).not.toHaveBeenCalled();
  });

  it('requires sign-in before contacting the price sources', async () => {
    expect((await post({ location: 'DK1', settings }, false)).status).toBe(401);
    expect(fetchEnergyPrice).not.toHaveBeenCalled();
  });
});
