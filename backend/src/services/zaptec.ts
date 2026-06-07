import { ZaptecCharger, ZaptecData, ZaptecSession, CacheEntry } from '../types/index';

const ZAPTEC_BASE = 'https://api.zaptec.com';
const TOKEN_CACHE_BUFFER_MS = 60_000;
const DATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ZaptecCredentials {
  username: string;
  password: string;
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();
const dataCache = new Map<string, CacheEntry<ZaptecData>>();

// Zaptec OperatingMode values
export const ZAPTEC_MODE: Record<number, string> = {
  0: 'unknown',
  1: 'unknown',
  2: 'disconnected',
  3: 'connected',
  5: 'charging',
  6: 'completed',
};

async function getZaptecToken(credentials: ZaptecCredentials, cacheKey: string): Promise<string> {
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - TOKEN_CACHE_BUFFER_MS) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: credentials.username,
    password: credentials.password,
    scope: 'openid offline_access',
  });

  const res = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zaptec auth failed: ${res.status} — ${text}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + json.expires_in * 1000;
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt });
  return json.access_token;
}

export async function fetchZaptecData(
  userId: string,
  credentials: ZaptecCredentials,
  fields: string[]
): Promise<ZaptecData> {
  const cacheKey = `zaptec:${userId}`;
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const token = await getZaptecToken(credentials, cacheKey);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const result: ZaptecData = { chargers: [], activeSession: null, installationName: null };

  const tasks: Promise<void>[] = [];

  if (fields.includes('charger_status') || fields.includes('active_session')) {
    tasks.push(
      fetch(`${ZAPTEC_BASE}/api/chargers`, { headers })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Zaptec chargers: ${r.status}`);
          const json = (await r.json()) as {
            Data?: Array<{ Id: string; Name: string; OperatingMode: number }>;
          };
          result.chargers = (json.Data ?? []).map((c) => ({
            id: c.Id,
            name: c.Name,
            operatingMode: c.OperatingMode,
          }));

          // Extract active session from charging chargers
          if (fields.includes('active_session')) {
            const chargingCharger = (json.Data ?? []).find((c) => c.OperatingMode === 5);
            if (chargingCharger) {
              // Fetch charger state for session details
              await fetch(`${ZAPTEC_BASE}/api/chargers/${chargingCharger.Id}/state`, { headers })
                .then(async (sr) => {
                  if (!sr.ok) return;
                  const state = (await sr.json()) as Array<{ StateId: number; ValueAsString: string }>;
                  const energyState = state.find((s) => s.StateId === 553); // SessionEnergy
                  const startState = state.find((s) => s.StateId === 718); // SessionStartTime
                  result.activeSession = {
                    id: chargingCharger.Id,
                    energyDeliveredKwh: energyState
                      ? parseFloat(energyState.ValueAsString) / 1000
                      : 0,
                    startDateTime: startState?.ValueAsString ?? new Date().toISOString(),
                    chargerName: chargingCharger.Name,
                  };
                })
                .catch(() => { /* degrade gracefully */ });
            }
          }
        })
        .catch(() => { /* degrade gracefully */ })
    );
  }

  if (fields.includes('installation_info')) {
    tasks.push(
      fetch(`${ZAPTEC_BASE}/api/installations`, { headers })
        .then(async (r) => {
          if (!r.ok) return;
          const json = (await r.json()) as { Data?: Array<{ Name: string }> };
          result.installationName = json.Data?.[0]?.Name ?? null;
        })
        .catch(() => { /* degrade gracefully */ })
    );
  }

  await Promise.all(tasks);
  dataCache.set(cacheKey, { data: result, expiresAt: Date.now() + DATA_CACHE_TTL_MS });
  return result;
}

export function clearZaptecCache(userId?: string): void {
  if (userId) {
    dataCache.delete(`zaptec:${userId}`);
    tokenCache.delete(`zaptec:${userId}`);
  } else {
    dataCache.clear();
    tokenCache.clear();
  }
}
