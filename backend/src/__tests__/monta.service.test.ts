import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMontaData, clearMontaCache } from '../services/monta';

const MOCK_TOKEN = { access_token: 'tok_test', expires_in: 3600 };
const MOCK_CHARGE_POINTS = {
  data: [
    { id: 'cp1', state: 'Available', name: 'Charger 1' },
    { id: 'cp2', state: 'Charging', name: 'Charger 2' },
    { id: 'cp3', state: 'Unavailable', name: 'Charger 3' },
  ],
};
const MOCK_CHARGES = {
  data: [
    { id: 's1', totalKwh: 12.5, startedAt: new Date(Date.now() - 60 * 60_000).toISOString() },
  ],
};

function makeFetchMock(overrides?: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/auth/token')) {
      return { ok: true, json: async () => ({ ...MOCK_TOKEN, ...overrides }) };
    }
    if (String(url).includes('/charges')) {
      return { ok: true, json: async () => MOCK_CHARGES };
    }
    if (String(url).includes('/charge-points')) {
      return { ok: true, json: async () => MOCK_CHARGE_POINTS };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  });
}

describe('fetchMontaData', () => {
  beforeEach(() => {
    clearMontaCache();
    vi.stubGlobal('fetch', makeFetchMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearMontaCache();
  });

  it('fetches token and charge points', async () => {
    const data = await fetchMontaData(
      'user1',
      { clientId: 'cid', clientSecret: 'csec' },
      ['charger_status']
    );

    expect(data.chargePoints).toHaveLength(3);
    expect(data.chargePoints[0].state).toBe('available');
    expect(data.chargePoints[1].state).toBe('charging');
    expect(data.chargePoints[2].state).toBe('offline');
  });

  it('fetches active sessions when requested', async () => {
    const data = await fetchMontaData(
      'user1',
      { clientId: 'cid', clientSecret: 'csec' },
      ['active_session']
    );

    expect(data.activeSessions).toHaveLength(1);
    expect(data.activeSessions[0].energyDeliveredKwh).toBe(12.5);
    expect(data.activeSessions[0].durationMin).toBeGreaterThan(50);
  });

  it('caches results — second call does not re-fetch', async () => {
    const fetchSpy = vi.mocked(fetch);

    await fetchMontaData('user2', { clientId: 'cid', clientSecret: 'csec' }, ['charger_status']);
    const callsAfterFirst = fetchSpy.mock.calls.length;

    await fetchMontaData('user2', { clientId: 'cid', clientSecret: 'csec' }, ['charger_status']);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('skips charge-point fetch when only today_stats requested', async () => {
    const fetchSpy = vi.mocked(fetch);
    await fetchMontaData('user3', { clientId: 'cid', clientSecret: 'csec' }, ['today_stats']);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/charge-points'))).toBe(false);
  });

  it('throws on auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' })
    );
    await expect(
      fetchMontaData('user4', { clientId: 'bad', clientSecret: 'bad' }, ['charger_status'])
    ).rejects.toThrow('Monta auth failed');
  });

  it('gracefully handles charge-points API failure (returns empty array)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/auth/token')) {
          return { ok: true, json: async () => MOCK_TOKEN };
        }
        // charge-points and charges fail
        return { ok: false, status: 500, text: async () => 'Server error' };
      })
    );
    const data = await fetchMontaData('user5', { clientId: 'cid', clientSecret: 'csec' }, ['charger_status']);
    expect(data.chargePoints).toHaveLength(0);
  });
});
