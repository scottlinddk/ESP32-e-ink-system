import { afterEach, describe, expect, it, vi } from 'vitest';
import { montaWidget } from '../widgets/monta';
import { zaptecWidget } from '../widgets/zaptec';

const region = { widthPx: 250, heightPx: 80 };
const typography = { xs: 7, sm: 8, base: 9, lg: 12, xl: 16 };
const montaConfig = { clientId: 'client', clientSecret: 'private-secret', showChargerStatus: false, showActiveSession: true, showTodayStats: false };
const zaptecConfig = { username: 'owner', password: 'private-password', showChargerStatus: true, showActiveSession: true, showInstallationInfo: true };
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('standalone EV widget provider contracts', () => {
  it('uses Monta camelCase auth, numeric IDs and nullable consumedKwh/startedAt', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      expect(url.origin).toBe('https://public-api.monta.com');
      expect(init?.redirect).toBe('error');
      if (url.pathname.endsWith('/auth/token')) {
        expect(JSON.parse(String(init?.body))).toEqual({ clientId: 'client', clientSecret: 'private-secret' });
        return json({ accessToken: 'token', accessTokenExpirationDate: new Date(Date.now() + 3_600_000).toISOString() });
      }
      expect(url.pathname).toBe('/api/v1/charges');
      expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'charging', page: '0', perPage: '100' });
      return json({ data: [{ id: 42, state: 'charging', consumedKwh: null, startedAt: null }], meta: { currentPage: 0, totalPageCount: 1, totalItemCount: 1 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await montaWidget.fetch(montaConfig, region);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.activeSessions[0]).toEqual({ id: '42', energyDeliveredKwh: null, startedAt: null, durationMin: null });
    const rendered = montaWidget.render(result.data, region, typography);
    expect(JSON.stringify(rendered)).toContain('Energy unknown');
    expect(JSON.stringify(rendered)).not.toContain('0 min');
  });

  it('calculates Monta created-today energy in the requested display zone', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T00:30:00Z'));
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.endsWith('/auth/token')
      ? json({ accessToken: 'token', accessTokenExpirationDate: '2026-10-02T01:30:00Z' })
      : json({ data: [
        { id: 1, createdAt: '2026-10-01T21:59:00Z', consumedKwh: 4 },
        { id: 2, createdAt: '2026-10-01T22:01:00Z', consumedKwh: 2 },
      ], meta: { currentPage: 0, totalPageCount: 1, totalItemCount: 2 } })));
    const result = await montaWidget.fetch({ ...montaConfig, showActiveSession: false, showTodayStats: true, timeZone: 'Europe/Copenhagen' }, region);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.todayKwh).toBe(2);
    expect(JSON.stringify(montaWidget.render(result.data, region, typography))).toContain('Created today: 2.0 kWh');
  });

  it('uses Zaptec mode3, kWh observation553 and singular installation without inventing timestamps', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === '/oauth/token') return json({ access_token: 'token', expires_in: 3600 });
      if (path === '/api/chargers') return json({ pages: 1, totalCount: 2, data: [
        { id: 'charging', name: 'Charging', operatingMode: 3 }, { id: 'finished', name: 'Finished', operatingMode: 5 },
      ] });
      if (path === '/api/chargers/charging/state') return json([{ stateId: 553, valueAsString: '5.2' }, { stateId: 718, valueAsString: 'true' }]);
      if (path === '/api/installation') return json({ data: [{ id: 'home', name: 'Home' }, { id: 'office', name: 'Office' }], pages: 1, totalCount: 2 });
      throw new Error('Unexpected URL');
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await zaptecWidget.fetch(zaptecConfig, region);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.activeSession).toMatchObject({ energyDeliveredKwh: 5.2, startDateTime: null });
    expect(result.data.installationName).toBeNull();
    const rendered = JSON.stringify(zaptecWidget.render(result.data, region, typography));
    expect(rendered).toContain('0 avail  1 charging');
    expect(rendered).toContain('5.2 kWh');
  });

  it.each(['monta', 'zaptec'])('%s fails closed on a partial list, without reporting empty success', async (provider) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/auth/token')) return json({ accessToken: 'token', accessTokenExpirationDate: new Date(Date.now() + 3_600_000).toISOString() });
      if (input.endsWith('/oauth/token')) return json({ access_token: 'token', expires_in: 3600 });
      return json(provider === 'monta' ? { data: [], meta: { currentPage: 0, totalPageCount: 1, totalItemCount: 2 } } : { data: [], pages: 1, totalCount: 2 });
    }));
    const result = provider === 'monta' ? await montaWidget.fetch(montaConfig, region) : await zaptecWidget.fetch(zaptecConfig, region);
    expect(result.ok).toBe(false);
  });

  it('does not display charger counts when only Zaptec active session is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.endsWith('/oauth/token')
      ? json({ access_token: 'token', expires_in: 3600 })
      : input.endsWith('/state') ? json([{ stateId: 553, valueAsString: '5.2' }])
      : json({ pages: 1, totalCount: 1, data: [{ id: 'charging', name: 'Garage', operatingMode: 3 }] })));
    const result = await zaptecWidget.fetch({ ...zaptecConfig, showChargerStatus: false, showInstallationInfo: false }, region);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chargers).toEqual([]);
    const rendered = JSON.stringify(zaptecWidget.render(result.data, region, typography));
    expect(rendered).toContain('5.2 kWh');
    expect(rendered).not.toContain('avail');
  });

  it.each(['monta', 'zaptec'])('%s keeps provider exceptions out of visible errors', async (provider) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-secret private-password https://secret')));
    const result = provider === 'monta' ? await montaWidget.fetch(montaConfig, region) : await zaptecWidget.fetch(zaptecConfig, region);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private-secret|private-password|https:/);
  });
});
