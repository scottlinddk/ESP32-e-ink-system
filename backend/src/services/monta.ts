import { createHash } from 'node:crypto';
import { MontaData, CacheEntry } from '../types/index';
import { providerJson } from './evProvider';

const MONTA_BASE = 'https://public-api.monta.com/api/v1';
const DATA_CACHE_TTL_MS = 5 * 60_000;
export interface MontaCredentials { clientId: string; clientSecret: string }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const dataCache = new Map<string, CacheEntry<MontaData>>();

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Monta returned an invalid response');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Monta returned an invalid ID');
  return String(value);
}
function energy(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Monta returned invalid energy');
  return value;
}
function timestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) throw new Error('Monta returned an invalid timestamp');
  return value;
}
function normaliseMontaState(value: unknown): string {
  if (value === 'available') return 'available';
  if (value === 'busy-charging') return 'charging';
  if (typeof value === 'string' && (value === 'busy' || value.startsWith('busy-'))) return 'busy';
  if (value === 'error' || value === 'disconnected' || value === 'passive') return 'offline';
  return 'unknown';
}

async function getMontaToken(credentials: MontaCredentials, cacheKey: string, signal: AbortSignal): Promise<string> {
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const json = record(await providerJson(`${MONTA_BASE}/auth/token`, {
    signal, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret }),
  }, 'Monta'));
  const expiresAt = typeof json.accessTokenExpirationDate === 'string' ? Date.parse(json.accessTokenExpirationDate) : NaN;
  if (typeof json.accessToken !== 'string' || !json.accessToken || json.accessToken.length > 8192 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Monta returned an invalid access token');
  }
  signal.throwIfAborted();
  tokenCache.set(cacheKey, { token: json.accessToken, expiresAt });
  return json.accessToken;
}

async function list(path: string, params: Record<string, string>, token: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ ...params, page: String(page), perPage: '100' });
    const json = record(await providerJson(`${MONTA_BASE}/${path}?${query}`, {
      signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 'Monta'));
    const meta = record(json.meta);
    if (!Array.isArray(json.data) || json.data.length > 100 || meta.currentPage !== page ||
        !Number.isInteger(meta.totalPageCount) || (meta.totalPageCount as number) < 0 ||
        !Number.isInteger(meta.totalItemCount) || (meta.totalItemCount as number) < 0) {
      throw new Error('Monta returned an invalid page');
    }
    if ((meta.totalPageCount as number) > 5 || (meta.totalItemCount as number) > 500) throw new Error('Monta result exceeds 500 items');
    for (const value of json.data) {
      const row = record(value);
      const rowId = id(row.id);
      if (seen.has(rowId)) throw new Error('Monta returned duplicate items');
      seen.add(rowId);
      rows.push(row);
    }
    if (page + 1 >= (meta.totalPageCount as number)) {
      if (rows.length !== meta.totalItemCount) throw new Error('Monta returned an incomplete result');
      return rows;
    }
    if (json.data.length === 0) throw new Error('Monta returned an incomplete page');
  }
  throw new Error('Monta result exceeds 500 items');
}

export async function fetchMontaData(
  userId: string, credentials: MontaCredentials, fields: string[],
  signal: AbortSignal = AbortSignal.timeout(10_000), timeZone = 'Europe/Copenhagen',
): Promise<MontaData> {
  signal.throwIfAborted();
  if (!credentials || typeof credentials.clientId !== 'string' || !credentials.clientId.trim() ||
      typeof credentials.clientSecret !== 'string' || !credentials.clientSecret.trim()) throw new Error('Monta credentials are missing');
  for (const cache of [tokenCache, dataCache]) {
    for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(key);
    while (cache.size >= 256) cache.delete(cache.keys().next().value!);
  }
  const now = Date.now();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = date.format(now);
  const digest = createHash('sha256').update(JSON.stringify([credentials.clientId, credentials.clientSecret])).digest('hex');
  const cacheKey = `monta:${userId}:${digest}`;
  const dataKey = `${cacheKey}:${[...new Set(fields)].sort().join(',')}:${timeZone}:${today}`;
  const cached = dataCache.get(dataKey);
  if (cached && now < cached.expiresAt) return cached.data;
  const token = await getMontaToken(credentials, cacheKey, signal);
  const result: MontaData = { chargePoints: [], activeSessions: [], todayKwh: null };
  const tasks: Promise<void>[] = [];
  if (fields.includes('charger_status')) tasks.push((async () => {
    const points = await list('charge-points', {}, token, signal);
    result.chargePoints = points.map((point) => ({
      id: id(point.id), state: normaliseMontaState(point.state),
      name: typeof point.name === 'string' ? point.name.slice(0, 200) : id(point.id),
    }));
  })());
  if (fields.includes('active_session')) tasks.push((async () => {
    const charges = await list('charges', { state: 'charging' }, token, signal);
    result.activeSessions = charges.filter((charge) => charge.state === 'charging').map((charge) => {
      const startedAt = timestamp(charge.startedAt);
      return {
        id: id(charge.id), energyDeliveredKwh: energy(charge.consumedKwh), startedAt,
        durationMin: startedAt ? Math.max(0, Math.round((now - Date.parse(startedAt)) / 60_000)) : null,
      };
    });
  })());
  if (fields.includes('today_stats')) tasks.push((async () => {
    // Monta filters CREATED time, not metered energy time. A 48h window covers
    // today's local date across UTC offsets and DST without inventing midnight.
    const charges = await list('charges', {
      fromDate: new Date(now - 48 * 60 * 60_000).toISOString(), toDate: new Date(now).toISOString(),
    }, token, signal);
    let total: number | null = 0;
    for (const charge of charges) {
      const createdAt = timestamp(charge.createdAt);
      if (!createdAt) throw new Error('Monta returned an invalid creation date');
      if (date.format(new Date(createdAt)) !== today) continue;
      const kwh = energy(charge.consumedKwh);
      total = total === null || kwh === null ? null : total + kwh;
    }
    result.todayKwh = total;
  })());
  try {
    await Promise.all(tasks);
    signal.throwIfAborted();
    dataCache.set(dataKey, { data: result, expiresAt: Date.now() + DATA_CACHE_TTL_MS });
    return result;
  } catch (error) {
    // Invalidate auth after provider failures as well as explicit credential edits.
    tokenCache.delete(cacheKey);
    throw error;
  }
}

export function clearMontaCache(userId?: string): void {
  for (const cache of [tokenCache, dataCache]) {
    if (!userId) cache.clear();
    else for (const key of cache.keys()) if (key.startsWith(`monta:${userId}:`)) cache.delete(key);
  }
}
