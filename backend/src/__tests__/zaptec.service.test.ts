import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchZaptecData, clearZaptecCache, ZAPTEC_MODE } from '../services/zaptec';

const MOCK_TOKEN = { access_token: 'ztok_test', expires_in: 3600 };
const MOCK_CHARGERS = {
  Data: [
    { Id: 'c1', Name: 'Garage', OperatingMode: 2 },  // disconnected = available
    { Id: 'c2', Name: 'Driveway', OperatingMode: 5 }, // charging
  ],
};
const MOCK_STATE = [
  { StateId: 553, ValueAsString: '5200' }, // SessionEnergy = 5200 Wh = 5.2 kWh
  { StateId: 718, ValueAsString: new Date(Date.now() - 30 * 60_000).toISOString() },
];
const MOCK_INSTALLATIONS = {
  Data: [{ Name: 'My Home' }],
};

function makeFetchMock() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/oauth/token')) {
      return { ok: true, json: async () => MOCK_TOKEN };
    }
    if (String(url).includes('/api/chargers/c2/state')) {
      return { ok: true, json: async () => MOCK_STATE };
    }
    if (String(url).includes('/api/chargers')) {
      return { ok: true, json: async () => MOCK_CHARGERS };
    }
    if (String(url).includes('/api/installations')) {
      return { ok: true, json: async () => MOCK_INSTALLATIONS };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  });
}

describe('fetchZaptecData', () => {
  beforeEach(() => {
    clearZaptecCache();
    vi.stubGlobal('fetch', makeFetchMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearZaptecCache();
  });

  it('fetches chargers and maps operating modes', async () => {
    const data = await fetchZaptecData(
      'user1',
      { username: 'u@e.com', password: 'pw' },
      ['charger_status']
    );
    expect(data.chargers).toHaveLength(2);
    expect(data.chargers[0].operatingMode).toBe(2);
    expect(data.chargers[1].operatingMode).toBe(5);
  });

  it('detects active session from charging charger', async () => {
    const data = await fetchZaptecData(
      'user1',
      { username: 'u@e.com', password: 'pw' },
      ['charger_status', 'active_session']
    );
    expect(data.activeSession).not.toBeNull();
    expect(data.activeSession!.energyDeliveredKwh).toBeCloseTo(5.2, 1);
    expect(data.activeSession!.chargerName).toBe('Driveway');
  });

  it('fetches installation name when installation_info requested', async () => {
    const data = await fetchZaptecData(
      'user1',
      { username: 'u@e.com', password: 'pw' },
      ['installation_info']
    );
    expect(data.installationName).toBe('My Home');
  });

  it('caches results — second call does not re-fetch', async () => {
    const fetchSpy = vi.mocked(fetch);
    await fetchZaptecData('user2', { username: 'u@e.com', password: 'pw' }, ['charger_status']);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await fetchZaptecData('user2', { username: 'u@e.com', password: 'pw' }, ['charger_status']);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('different users have separate caches', async () => {
    const fetchSpy = vi.mocked(fetch);
    await fetchZaptecData('userA', { username: 'a@e.com', password: 'pw' }, ['charger_status']);
    const callsForA = fetchSpy.mock.calls.length;
    await fetchZaptecData('userB', { username: 'b@e.com', password: 'pw' }, ['charger_status']);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsForA);
  });

  it('throws on auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Bad credentials' })
    );
    await expect(
      fetchZaptecData('user3', { username: 'bad', password: 'bad' }, ['charger_status'])
    ).rejects.toThrow('Zaptec auth failed');
  });

  it('returns empty chargers on API failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/oauth/token')) return { ok: true, json: async () => MOCK_TOKEN };
        return { ok: false, status: 503, text: async () => 'Unavailable' };
      })
    );
    const data = await fetchZaptecData('user4', { username: 'u@e.com', password: 'pw' }, ['charger_status']);
    expect(data.chargers).toHaveLength(0);
    expect(data.activeSession).toBeNull();
  });
});

describe('ZAPTEC_MODE', () => {
  it('maps known operating modes', () => {
    expect(ZAPTEC_MODE[5]).toBe('charging');
    expect(ZAPTEC_MODE[2]).toBe('disconnected');
    expect(ZAPTEC_MODE[6]).toBe('completed');
  });
});
