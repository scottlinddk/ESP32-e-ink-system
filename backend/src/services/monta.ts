import { MontaChargePoint, MontaData, MontaSession, CacheEntry } from '../types/index';

const MONTA_BASE = 'https://api.public-api.monta.com';
const TOKEN_CACHE_BUFFER_MS = 60_000; // refresh 60s before expiry
const DATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface MontaCredentials {
  clientId: string;
  clientSecret: string;
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const dataCache = new Map<string, CacheEntry<MontaData>>();

async function getMontaToken(credentials: MontaCredentials, cacheKey: string): Promise<string> {
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - TOKEN_CACHE_BUFFER_MS) {
    return cached.token;
  }

  const res = await fetch(`${MONTA_BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Monta auth failed: ${res.status} — ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + json.expires_in * 1000;
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt });
  return json.access_token;
}

function normaliseMontaState(raw: string): string {
  const map: Record<string, string> = {
    Available: 'available',
    Charging: 'charging',
    Occupied: 'busy',
    Unavailable: 'offline',
    Faulted: 'offline',
  };
  return map[raw] ?? raw.toLowerCase();
}

export async function fetchMontaData(
  userId: string,
  credentials: MontaCredentials,
  fields: string[]
): Promise<MontaData> {
  const cacheKey = `monta:${userId}`;
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const token = await getMontaToken(credentials, cacheKey);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const result: MontaData = { chargePoints: [], activeSessions: [], todayKwh: null };

  const tasks: Promise<void>[] = [];

  if (fields.includes('charger_status') || fields.includes('active_session')) {
    tasks.push(
      fetch(`${MONTA_BASE}/v1/charge-points`, { headers })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Monta charge-points: ${r.status}`);
          const json = (await r.json()) as { data?: Array<{ id: string; state: string; name: string }> };
          result.chargePoints = (json.data ?? []).map((cp) => ({
            id: cp.id,
            state: normaliseMontaState(cp.state),
            name: cp.name ?? cp.id,
          }));
        })
        .catch(() => { /* degrade gracefully */ })
    );
  }

  if (fields.includes('active_session') || fields.includes('today_stats')) {
    tasks.push(
      fetch(`${MONTA_BASE}/v1/charges?state=charging&limit=10`, { headers })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Monta charges: ${r.status}`);
          const json = (await r.json()) as {
            data?: Array<{
              id: string;
              totalKwh?: number;
              startedAt?: string;
              chargePointId?: string;
            }>;
          };
          const now = Date.now();
          result.activeSessions = (json.data ?? []).map((c) => {
            const startMs = c.startedAt ? new Date(c.startedAt).getTime() : now;
            return {
              id: c.id,
              energyDeliveredKwh: c.totalKwh ?? 0,
              startedAt: c.startedAt ?? new Date().toISOString(),
              durationMin: Math.round((now - startMs) / 60_000),
            };
          });
        })
        .catch(() => { /* degrade gracefully */ })
    );
  }

  if (fields.includes('today_stats')) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    tasks.push(
      fetch(
        `${MONTA_BASE}/v1/charges?startedAfter=${today.toISOString()}&limit=100`,
        { headers }
      )
        .then(async (r) => {
          if (!r.ok) return;
          const json = (await r.json()) as { data?: Array<{ totalKwh?: number }> };
          result.todayKwh = (json.data ?? []).reduce((sum, c) => sum + (c.totalKwh ?? 0), 0);
        })
        .catch(() => { /* degrade gracefully */ })
    );
  }

  await Promise.all(tasks);
  dataCache.set(cacheKey, { data: result, expiresAt: Date.now() + DATA_CACHE_TTL_MS });
  return result;
}

export function clearMontaCache(userId?: string): void {
  if (userId) {
    dataCache.delete(`monta:${userId}`);
    tokenCache.delete(`monta:${userId}`);
  } else {
    dataCache.clear();
    tokenCache.clear();
  }
}
