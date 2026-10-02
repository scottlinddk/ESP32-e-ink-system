import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMontaCache, fetchMontaData } from '../services/monta';

const credentials = { clientId: 'client-id', clientSecret: 'private-secret' };
const page = (data: unknown[], currentPage = 0, totalPageCount = 1, totalItemCount = data.length) => ({
  data, meta: { currentPage, totalPageCount, totalItemCount, itemCount: data.length, perPage: 100 },
});
const point = { id: 21, name: 'Garage', state: 'busy-charging' };
const charge = { id: 42, state: 'charging', consumedKwh: 12.5, startedAt: '2026-10-02T10:00:00Z', createdAt: '2026-10-02T09:00:00Z' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const token = () => ({ accessToken: 'monta-token', accessTokenExpirationDate: new Date(Date.now() + 3_600_000).toISOString() });
const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
function defaults() {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/auth/token')) return json(token());
    if (url.pathname.endsWith('/charge-points')) return json(page([point]));
    if (url.pathname.endsWith('/charges')) return json(page([charge]));
    return json({}, 404);
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T11:00:00Z'));
  clearMontaCache(); fetchMock.mockReset(); defaults(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearMontaCache(); });
const load = (fields = ['charger_status', 'active_session'], zone = 'Europe/Copenhagen', creds = credentials, user = 'alice') =>
  fetchMontaData(user, creds, fields, undefined, zone);

describe('Monta official API contract', () => {
  it('uses the public API base, camelCase token payload, numeric IDs and consumedKwh', async () => {
    const result = await load();
    expect(fetchMock.mock.calls[0][0]).toBe('https://public-api.monta.com/api/v1/auth/token');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(credentials);
    expect(result.chargePoints).toEqual([{ id: '21', name: 'Garage', state: 'charging' }]);
    expect(result.activeSessions).toEqual([{ id: '42', energyDeliveredKwh: 12.5, startedAt: charge.startedAt, durationMin: 60 }]);
    const url = new URL(String(fetchMock.mock.calls.find(([url]) => String(url).includes('/charges?'))![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'charging', page: '0', perPage: '100' });
  });
  it('maps the documented lowercase charge-point states including unknown/null', async () => {
    const states = ['available', 'busy-charging', 'busy-blocked', 'busy-reserved', 'error', 'disconnected', 'passive', 'other', null];
    fetchMock.mockImplementation(async (url) => String(url).includes('/auth/token') ? json(token()) : json(page(states.map((state, index) => ({ id: index, state })))));
    expect((await load(['charger_status'])).chargePoints.map((cp) => cp.state)).toEqual(['available', 'charging', 'busy', 'busy', 'offline', 'offline', 'offline', 'unknown', 'unknown']);
  });
  it('preserves unavailable energy and start times instead of fabricating zero or now', async () => {
    fetchMock.mockImplementation(async (url) => String(url).includes('/auth/token') ? json(token()) : json(page([{ ...charge, consumedKwh: null, startedAt: null }])));
    expect((await load(['active_session'])).activeSessions[0]).toMatchObject({ energyDeliveredKwh: null, startedAt: null, durationMin: null });
  });
  it('uses zero as a real energy reading', async () => {
    fetchMock.mockImplementation(async (url) => String(url).includes('/auth/token') ? json(token()) : json(page([{ ...charge, consumedKwh: 0 }])));
    expect((await load(['active_session'])).activeSessions[0].energyDeliveredKwh).toBe(0);
  });
  it('follows zero-based pagination rather than truncating counts at the first page', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/auth/token')) return json(token());
      const n = Number(url.searchParams.get('page'));
      return json(page([{ ...point, id: n + 1 }], n, 2, 2));
    });
    expect((await load(['charger_status'])).chargePoints).toHaveLength(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://public-api.monta.com/api/v1/charge-points?page=1&perPage=100');
  });
  it.each([['Europe/Copenhagen', 5], ['America/Los_Angeles', 6]])('filters sessions created today in %s, regardless of server time', async (zone, expected) => {
    vi.setSystemTime(new Date('2026-10-02T00:30:00Z'));
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/auth/token')) return json(token());
      expect(url.searchParams.has('startedAfter')).toBe(false);
      expect(url.searchParams.has('fromDate')).toBe(true);
      expect(url.searchParams.has('toDate')).toBe(true);
      return json(page([
        { ...charge, id: 1, createdAt: '2026-10-01T21:59:00Z', consumedKwh: 1 },
        { ...charge, id: 2, createdAt: '2026-10-01T22:00:00Z', consumedKwh: 1 },
        { ...charge, id: 3, createdAt: '2026-10-02T00:01:00Z', consumedKwh: 4 },
      ]));
    });
    // LA's Oct 1 includes all three sessions; Copenhagen's Oct 2 includes two.
    const result = await load(['today_stats'], zone);
    expect(result.todayKwh).toBe(expected);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('state=charging'))).toBe(false);
  });
  it.each(['2026-03-29T22:30:00Z', '2026-10-25T23:30:00Z'])('selects the correct day across DST at %s', async (now) => {
    vi.setSystemTime(new Date(now));
    const justBeforeLocalMidnight = now.startsWith('2026-03') ? '2026-03-29T21:59:59Z' : '2026-10-25T22:59:59Z';
    fetchMock.mockImplementation(async (url) => String(url).includes('/auth/token') ? json(token()) : json(page([
      { ...charge, id: 1, createdAt: justBeforeLocalMidnight, consumedKwh: 100 },
      { ...charge, id: 2, createdAt: now, consumedKwh: 3 },
    ])));
    expect((await load(['today_stats'])).todayKwh).toBe(3);
  });
  it('does not claim an aggregate when a created-today session has unknown consumption', async () => {
    fetchMock.mockImplementation(async (url) => String(url).includes('/auth/token') ? json(token()) : json(page([{ ...charge, consumedKwh: null }])));
    expect((await load(['today_stats'])).todayKwh).toBeNull();
  });
});

describe('Monta validation and cache isolation', () => {
  it('keys cache by user, full credentials, fields, time zone and local date', async () => {
    await load(); const calls = fetchMock.mock.calls.length;
    await load(['active_session', 'charger_status']); expect(fetchMock).toHaveBeenCalledTimes(calls);
    await load(['today_stats']); expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    const todayCalls = fetchMock.mock.calls.length;
    await load(['today_stats'], 'America/Los_Angeles'); expect(fetchMock.mock.calls.length).toBeGreaterThan(todayCalls);
    await load(undefined, undefined, { ...credentials, clientSecret: 'rotated-secret' });
    await load(undefined, undefined, credentials, 'bob');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/token'))).toHaveLength(3);
    clearMontaCache('alice');
    await load();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/token'))).toHaveLength(4);
  });
  it('refreshes at local midnight even within the five-minute data TTL', async () => {
    vi.setSystemTime(new Date('2026-10-01T21:59:00Z'));
    await load(['today_stats']); const calls = fetchMock.mock.calls.length;
    vi.setSystemTime(new Date('2026-10-01T22:01:00Z'));
    await load(['today_stats']); expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
  it('never returns or caches a successful empty result after provider failure', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/auth/token') ? json(token()) : json({ secret: 'private-secret', detail: 'unsafe upstream body' }, 403));
    await expect(load(['charger_status'])).rejects.toThrow('Monta request failed (403)');
    defaults();
    expect((await load(['charger_status'])).chargePoints).toHaveLength(1);
  });
  it.each([
    { data: {} }, page([{ ...charge, consumedKwh: '12.5' }]), page([{ ...charge, consumedKwh: -1 }]),
    page([{ ...charge, startedAt: 'bad-time' }]), page([charge], 0, 6, 501), page([charge], 0, 1, 2),
  ])('rejects malformed, unsafe or excessive provider data', async (body) => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/auth/token') ? json(token()) : json(body));
    await expect(load(['active_session'])).rejects.toThrow('Monta');
  });
  it('rejects malformed token responses and does not expose raw auth errors', async () => {
    fetchMock.mockResolvedValue(json({ access_token: 'wrong-contract', expires_in: 3600 }));
    await expect(load()).rejects.toThrow('invalid access token');
    fetchMock.mockRejectedValue(new Error('private-secret https://upstream?password=secret'));
    await expect(load()).rejects.toThrow('Monta request failed');
  });
  it('cancels a response body after the deadline and never caches partial results', async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => {});
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/token')) return json(token());
      return new Response(new ReadableStream({ start() {}, cancel }));
    });
    const pending = fetchMontaData('alice', credentials, ['charger_status'], controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort(new Error('Source deadline reached'));
    await expect(pending).rejects.toThrow('Source deadline reached');
    expect(cancel).toHaveBeenCalled();
    defaults();
    expect((await load(['charger_status'])).chargePoints).toHaveLength(1);
  });
  it('bounds response bytes even without a content-length header', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(1_048_577)));
    await expect(load()).rejects.toThrow('invalid response');
  });
});
