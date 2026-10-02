import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearZaptecCache, fetchZaptecData, ZAPTEC_MODE } from '../services/zaptec';

const credentials = { username: 'owner@example.com', password: 'private-password' };
const chargers = [
  { id: 'charger-1', name: 'Garage', operatingMode: 1 },
  { id: 'charger-2', name: 'Driveway', operatingMode: 3 },
  { id: 'charger-3', name: 'Finished', operatingMode: 5 },
  { id: 'charger-4', name: 'Waiting', operatingMode: 2 },
];
const page = (data: unknown[], pages = 1, totalCount = data.length) => ({ data, pages, totalCount });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const token = { access_token: 'zaptec-token', expires_in: 3600 };
const observations = [{ stateId: 553, valueAsString: '5.2' }, { stateId: 718, valueAsString: 'true' }];
const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
function defaults() {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth/token') return json(token);
    if (url.pathname === '/api/chargers') return json(page(chargers));
    if (url.pathname.endsWith('/state')) return json(observations);
    if (url.pathname === '/api/installation') return json(page([{ id: 'installation-1', name: 'Home' }]));
    return json({}, 404);
  });
}
beforeEach(() => { clearZaptecCache(); fetchMock.mockReset(); defaults(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearZaptecCache(); });
const load = (fields = ['charger_status', 'active_session', 'installation_info'], creds = credentials, user = 'alice') =>
  fetchZaptecData(user, creds, fields);

describe('Zaptec official API contract', () => {
  it('uses camelCase data, correct charging mode and a singular installation endpoint', async () => {
    const result = await load();
    expect(result.chargers).toEqual(chargers);
    expect(result.installationName).toBe('Home');
    expect(result.activeSession).toEqual({ id: 'charger-2', energyDeliveredKwh: 5.2, startDateTime: null, chargerName: 'Driveway' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://api.zaptec.com/api/chargers/charger-2/state');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://api.zaptec.com/api/installation?pageIndex=0&pageSize=100');
    expect(Object.fromEntries(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)))).toEqual({ grant_type: 'password', ...credentials, scope: 'openid' });
  });
  it('maps published mode values without calling finished chargers charging', () => {
    expect(ZAPTEC_MODE).toEqual({ 0: 'unknown', 1: 'disconnected', 2: 'requesting', 3: 'charging', 5: 'finished' });
  });
  it('does not request a session for a finished charger', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token) : json(page([{ ...chargers[2] }])));
    expect((await load(['active_session'])).activeSession).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/state'))).toBe(false);
  });
  it.each([['0', 0], [null, null], [undefined, null]])('preserves energy observation %s without inventing a start time', async (value, expected) => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token)
      : String(url).endsWith('/state') ? json([{ stateId: 718, valueAsString: 'true' }, ...(value === undefined ? [] : [{ stateId: 553, valueAsString: value }])])
      : json(page(chargers)));
    expect((await load(['active_session'])).activeSession).toMatchObject({ energyDeliveredKwh: expected, startDateTime: null });
  });
  it('follows pageIndex pagination rather than truncating counts', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/oauth/token') return json(token);
      const index = Number(url.searchParams.get('pageIndex'));
      return json(page([chargers[index]], 2, 2));
    });
    expect((await load(['charger_status'])).chargers).toHaveLength(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://api.zaptec.com/api/chargers?pageIndex=1&pageSize=100');
  });
  it('accepts an explicitly empty nullable data array', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token) : json({ data: null, pages: 0, totalCount: 0 }));
    expect((await load(['charger_status'])).chargers).toEqual([]);
  });
  it('does not label an account-wide charger list with an arbitrary installation name', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token)
      : json(page([{ id: 'home', name: 'Home' }, { id: 'office', name: 'Office' }])));
    expect((await load(['installation_info'])).installationName).toBeNull();
  });
});

describe('Zaptec validation and cache isolation', () => {
  it('keys cache by full credentials and fields and isolates account ownership', async () => {
    await load(); const calls = fetchMock.mock.calls.length;
    await load(['active_session', 'installation_info', 'charger_status']); expect(fetchMock).toHaveBeenCalledTimes(calls);
    await load(['charger_status']); expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    await load(undefined, { ...credentials, password: 'rotated-password' });
    await load(undefined, credentials, 'bob');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(3);
    clearZaptecCache('alice');
    await load();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(4);
  });
  it('does not cache failures or expose raw response bodies', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token) : json({ error: 'private-password https://secret' }, 503));
    await expect(load()).rejects.toThrow('Zaptec request failed (503)');
    defaults();
    expect((await load()).chargers).toHaveLength(4);
  });
  it.each(['5.2kWh', '', '-1', 'NaN', 'Infinity', 5.2])('rejects malformed session energy %s', async (value) => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token)
      : String(url).endsWith('/state') ? json([{ stateId: 553, valueAsString: value }]) : json(page(chargers)));
    await expect(load(['active_session'])).rejects.toThrow('invalid session energy');
  });
  it.each([{ Data: [] }, page([{ ...chargers[0], operatingMode: '3' }]), page(chargers, 6, 501), page([{ id: null }]), page(chargers, 1, 5)])(
    'rejects malformed or oversized charger lists', async (body) => {
      fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token) : json(body));
      await expect(load(['charger_status'])).rejects.toThrow('Zaptec');
    },
  );
  it('rejects malformed token responses and sanitizes network exceptions', async () => {
    fetchMock.mockResolvedValue(json({ access_token: 'token', expires_in: '3600' }));
    await expect(load()).rejects.toThrow('invalid access token');
    fetchMock.mockRejectedValue(new Error('private-password https://secret'));
    await expect(load()).rejects.toThrow('Zaptec request failed');
  });
  it('cancels a response body and never caches an aborted result', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/oauth/token') ? json(token)
      : new Response(new ReadableStream({ start() {}, cancel })));
    const pending = fetchZaptecData('alice', credentials, ['charger_status'], controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort(new Error('Source deadline reached'));
    await expect(pending).rejects.toThrow('Source deadline reached');
    expect(cancel).toHaveBeenCalled();
    defaults();
    expect((await load(['charger_status'])).chargers).toHaveLength(4);
  });
  it('bounds announced response bytes and releases the rejected body', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start() {}, cancel }), { headers: { 'content-length': '1048577' } }));
    await expect(load()).rejects.toThrow('response too large');
    expect(cancel).toHaveBeenCalled();
  });
});
