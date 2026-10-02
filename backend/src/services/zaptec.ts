import { createHash } from 'node:crypto';
import { ZaptecData, CacheEntry } from '../types/index';
import { providerJson } from './evProvider';

const ZAPTEC_BASE = 'https://api.zaptec.com';
const DATA_CACHE_TTL_MS = 5 * 60_000;
export interface ZaptecCredentials { username: string; password: string }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const dataCache = new Map<string, CacheEntry<ZaptecData>>();

// https://docs.zaptec.com/reference/api_chargers_get
export const ZAPTEC_MODE: Record<number, string> = {
  0: 'unknown', 1: 'disconnected', 2: 'requesting', 3: 'charging', 5: 'finished',
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Zaptec returned an invalid response');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new Error('Zaptec returned an invalid ID');
  return value;
}
async function getZaptecToken(credentials: ZaptecCredentials, key: string, signal: AbortSignal): Promise<string> {
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const body = new URLSearchParams({ grant_type: 'password', username: credentials.username, password: credentials.password, scope: 'openid' });
  const json = record(await providerJson(`${ZAPTEC_BASE}/oauth/token`, {
    signal, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  }, 'Zaptec'));
  if (typeof json.access_token !== 'string' || !json.access_token || json.access_token.length > 8192 ||
      typeof json.expires_in !== 'number' || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
    throw new Error('Zaptec returned an invalid access token');
  }
  signal.throwIfAborted();
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + Math.min(json.expires_in, 86_400) * 1000 });
  return json.access_token;
}
async function list(path: string, token: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
    const params = new URLSearchParams({ pageIndex: String(pageIndex), pageSize: '100' });
    const json = record(await providerJson(`${ZAPTEC_BASE}/api/${path}?${params}`, {
      signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 'Zaptec'));
    const data = json.data === null && json.totalCount === 0 ? [] : json.data;
    if (!Array.isArray(data) || data.length > 100 || !Number.isInteger(json.pages) || (json.pages as number) < 0 ||
        !Number.isInteger(json.totalCount) || (json.totalCount as number) < 0) throw new Error('Zaptec returned an invalid page');
    if ((json.pages as number) > 5 || (json.totalCount as number) > 500) throw new Error('Zaptec result exceeds 500 items');
    for (const value of data) {
      const row = record(value);
      const rowId = id(row.id);
      if (seen.has(rowId)) throw new Error('Zaptec returned duplicate items');
      seen.add(rowId);
      rows.push(row);
    }
    if (pageIndex + 1 >= (json.pages as number)) {
      if (rows.length !== json.totalCount) throw new Error('Zaptec returned an incomplete result');
      return rows;
    }
    if (data.length === 0) throw new Error('Zaptec returned an incomplete page');
  }
  throw new Error('Zaptec result exceeds 500 items');
}

export async function fetchZaptecData(
  userId: string, credentials: ZaptecCredentials, fields: string[],
  signal: AbortSignal = AbortSignal.timeout(10_000),
): Promise<ZaptecData> {
  signal.throwIfAborted();
  if (!credentials || typeof credentials.username !== 'string' || !credentials.username.trim() ||
      typeof credentials.password !== 'string' || !credentials.password.trim()) throw new Error('Zaptec credentials are missing');
  for (const cache of [tokenCache, dataCache]) {
    for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(key);
    while (cache.size >= 256) cache.delete(cache.keys().next().value!);
  }
  const digest = createHash('sha256').update(JSON.stringify([credentials.username, credentials.password])).digest('hex');
  const key = `zaptec:${userId}:${digest}`;
  const dataKey = `${key}:${[...new Set(fields)].sort().join(',')}`;
  const cached = dataCache.get(dataKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const token = await getZaptecToken(credentials, key, signal);
  const result: ZaptecData = { chargers: [], activeSession: null, installationName: null };
  const tasks: Promise<void>[] = [];
  if (fields.includes('charger_status') || fields.includes('active_session')) tasks.push((async () => {
    const chargers = await list('chargers', token, signal);
    const mappedChargers = chargers.map((charger) => {
      if (!Number.isInteger(charger.operatingMode)) throw new Error('Zaptec returned an invalid operating mode');
      return { id: id(charger.id), name: typeof charger.name === 'string' ? charger.name.slice(0, 200) : id(charger.id), operatingMode: charger.operatingMode as number };
    });
    if (fields.includes('charger_status')) result.chargers = mappedChargers;
    if (!fields.includes('active_session')) return;
    const charging = mappedChargers.find((charger) => charger.operatingMode === 3);
    if (!charging) return;
    const values = await providerJson(`${ZAPTEC_BASE}/api/chargers/${encodeURIComponent(charging.id)}/state`, {
      signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 'Zaptec');
    if (!Array.isArray(values) || values.length > 512) throw new Error('Zaptec returned invalid charger state');
    const observation = values.map(record).find((value) => value.stateId === 553);
    const value = observation?.valueAsString;
    let kwh: number | null = null;
    if (value != null) {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Zaptec returned invalid session energy');
      kwh = Number(value);
      if (!Number.isFinite(kwh) || kwh < 0) throw new Error('Zaptec returned invalid session energy');
    }
    // Observation 553 is already kWh. 718 is FinalStopActive, not a start time.
    result.activeSession = { id: charging.id, energyDeliveredKwh: kwh, startDateTime: null, chargerName: charging.name };
  })());
  if (fields.includes('installation_info')) tasks.push((async () => {
    const installations = await list('installation', token, signal);
    // An account may span several installations; do not label another charger
    // with the arbitrary first installation's name.
    const name = installations.length === 1 ? installations[0].name : null;
    if (name != null && typeof name !== 'string') throw new Error('Zaptec returned an invalid installation');
    result.installationName = typeof name === 'string' ? name.slice(0, 200) : null;
  })());
  try {
    await Promise.all(tasks);
    signal.throwIfAborted();
    dataCache.set(dataKey, { data: result, expiresAt: Date.now() + DATA_CACHE_TTL_MS });
    return result;
  } catch (error) {
    tokenCache.delete(key);
    throw error;
  }
}

export function clearZaptecCache(userId?: string): void {
  for (const cache of [tokenCache, dataCache]) {
    if (!userId) cache.clear();
    else for (const key of cache.keys()) if (key.startsWith(`zaptec:${userId}:`)) cache.delete(key);
  }
}
