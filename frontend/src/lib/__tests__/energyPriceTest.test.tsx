import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, testEnergyPrice } from '../api';
import { createEnergyPriceTest, energyPriceTestError } from '../energyPriceTest';
import { STRINGS } from '../strings';
import { EnergyPriceTest } from '../../components/dashboard/EnergyPriceTest';
import type { EnergyPrice, EnergyPriceSettings } from '../../types';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' }, isSignedIn: true, getToken: async () => 'account-token' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: 'en', t: STRINGS.en }) }));
afterEach(() => { vi.unstubAllGlobals(); });
const settings: EnergyPriceSettings = { mode: 'consumer', gridGln: '5790000611003', gridChargeCodes: ['CD', 'CD R'], retailerMarkupOre: 10 };
const price: EnergyPrice = { now: 210.5, average: 190, trend: 'up', basis: 'consumer' };

describe('energy price test API and diagnostics', () => {
  it('sends the draft zone and settings with account auth and cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ price })));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect(await testEnergyPrice('account-token', 'DK1', settings, signal)).toEqual({ price });
    expect(fetchMock).toHaveBeenCalledWith('/api/preferences/energy-price/test', {
      method: 'POST', body: JSON.stringify({ location: 'DK1', settings }), signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer account-token' },
    });
  });

  it('keeps the missing tariff codes from the server response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'missing_tariff', missingCodes: ['CD', 'CD R'], error: 'PRIVATE_PROVIDER_VALUE' }), { status: 400 })));
    const error = await testEnergyPrice('account-token', 'DK1', settings).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(energyPriceTestError(error)).toEqual({ code: 'missing_tariff', missingCodes: ['CD', 'CD R'] });
  });

  it('falls back to a generic code and drops codes outside a tariff diagnostic', () => {
    expect(energyPriceTestError(new Error('https://upstream.invalid/SECRET'))).toEqual({ code: 'unavailable', missingCodes: [] });
    expect(energyPriceTestError({ code: 'SECRET' })).toEqual({ code: 'unavailable', missingCodes: [] });
    expect(energyPriceTestError(new ApiError(502, 'x', 'unavailable', ['EA-001']))).toEqual({ code: 'unavailable', missingCodes: [] });
  });

  it('publishes success and the named missing codes', async () => {
    const publish = vi.fn();
    const test = createEnergyPriceTest(publish);
    await test.run(async () => { throw new ApiError(400, 'x', 'missing_tariff', ['CD']); });
    expect(publish).toHaveBeenLastCalledWith({ status: 'error', code: 'missing_tariff', missingCodes: ['CD'] });
    await test.run(async () => price);
    expect(publish).toHaveBeenLastCalledWith({ status: 'success', price });
    test.dispose();
  });

  it('renders a test button for a signed-in account', () => {
    const html = renderToStaticMarkup(<EnergyPriceTest zone="DK1" settings={settings} />);
    expect(html).toContain('Test price');
    expect(html).toContain('without saving them');
  });
});
