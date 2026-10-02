import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPreferences, upsertPreferences } from '../services/database';
import router from '../routes/preferences';
import { DEFAULT_PREFS } from '../services/displayData';
import { exportDisplayTemplate, parseDisplayTemplate } from '../utils/displayTemplates';
import { parseEnergyPriceSettings } from '../utils/energyPriceSettings';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.clerkUserId = 'clerk-user'; next(); } }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
const consumer = { mode: 'consumer' as const, gridGln: '5790000610099', gridChargeCodes: ['TCL<100_02', 'discount'], retailerMarkupOre: 5 };
const invalid = [
  null, [], 'consumer', {}, { mode: 'other' }, { mode: 'spot', gridGln: consumer.gridGln },
  { ...consumer, extra: true }, { ...consumer, gridGln: 5790000610099 }, { ...consumer, gridGln: '123' },
  { ...consumer, gridChargeCodes: [] }, { ...consumer, gridChargeCodes: Array(6).fill('tariff') },
  { ...consumer, gridChargeCodes: ['A', 'A'] }, { ...consumer, gridChargeCodes: [' a'] },
  { ...consumer, gridChargeCodes: [''] }, { ...consumer, gridChargeCodes: [12] },
  { ...consumer, gridChargeCodes: ['A'.repeat(21)] }, { ...consumer, gridChargeCodes: ['A\nB'] },
  { ...consumer, retailerMarkupOre: '5' }, { ...consumer, retailerMarkupOre: null },
  { ...consumer, retailerMarkupOre: 1001 }, { mode: 'consumer', gridGln: consumer.gridGln, gridChargeCodes: ['CD'] },
];

describe('electricity settings persistence and portable templates', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getPreferences).mockResolvedValue(null); });
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('defaults to spot without guessing a consumer tariff', async () => {
    const body = await (await fetch(url)).json() as { preferences: unknown };
    expect(body.preferences).toMatchObject({ energy_price_settings: { mode: 'spot' } });
  });
  it.each([{ mode: 'spot' as const }, consumer])('saves a complete profile for the authenticated owner and round-trips templates: %j', async (profile) => {
    const settings = { energy_price_settings: profile, energy_price_location: 'DK1' };
    vi.mocked(upsertPreferences).mockResolvedValue({ ...DEFAULT_PREFS, ...settings });
    const response = await post({ ...settings, user_id: 'other' });
    expect(response.status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', settings);
    const exported = exportDisplayTemplate({ ...DEFAULT_PREFS, ...settings });
    expect(parseDisplayTemplate(JSON.parse(JSON.stringify(exported))).settings).toMatchObject(settings);
  });
  it.each(invalid.map((profile) => ({ profile })))('rejects the whole update/template without saving invalid profile $profile', async ({ profile }) => {
    expect((await post({ show_energy_price: true, energy_price_settings: profile })).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
    expect(() => parseDisplayTemplate({ format: 'esp32-eink-template', version: 1,
      settings: { energy_price_settings: profile } })).toThrow();
  });
  it('rejects invalid areas and non-finite markups, and accepts negative contract adjustments', async () => {
    expect((await post({ energy_price_location: 'DE' })).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
    for (const retailerMarkupOre of [NaN, Infinity, -Infinity]) {
      expect(() => parseEnergyPriceSettings({ ...consumer, retailerMarkupOre })).toThrow();
    }
    expect(parseEnergyPriceSettings({ ...consumer, retailerMarkupOre: -2 }).mode).toBe('consumer');
  });
});
