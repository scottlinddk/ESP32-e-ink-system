import { createHmac, randomBytes } from 'crypto';
import { encrypt, decrypt } from '../utils/crypto';
import { getSupabaseClient } from './database';
import { CacheEntry, StravaData, StravaGoalStat } from '../types/index';
import { logger } from '../lib/logger';

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const cache = new Map<string, CacheEntry<StravaData>>();

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

// ────────────────────────────────────────────────────────────────────────────────
// OAuth token management
// ────────────────────────────────────────────────────────────────────────────────

export interface OAuthConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  provider_account_id: string | null;
}

export async function getOAuthConnection(
  userId: string,
  provider: string
): Promise<OAuthConnectionRow | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertOAuthConnection(
  userId: string,
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  providerAccountId?: string
): Promise<void> {
  const db = getSupabaseClient();
  const { error } = await db.from('oauth_connections').upsert(
    {
      user_id: userId,
      provider,
      access_token: encrypt(accessToken),
      refresh_token: refreshToken ? encrypt(refreshToken) : null,
      expires_at: expiresAt?.toISOString() ?? null,
      provider_account_id: providerAccountId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) throw new Error(error.message);
}

export async function deleteOAuthConnection(userId: string, provider: string): Promise<void> {
  const db = getSupabaseClient();
  const { error } = await db
    .from('oauth_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) throw new Error(error.message);
}

// ────────────────────────────────────────────────────────────────────────────────
// State token helpers (CSRF protection for OAuth callbacks)
// ────────────────────────────────────────────────────────────────────────────────

const STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

export function createOAuthState(userId: string): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error('OAUTH_STATE_SECRET env var is required');
  const payload = Buffer.from(
    JSON.stringify({ u: userId, n: randomBytes(8).toString('hex'), t: Date.now() })
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error('OAUTH_STATE_SECRET env var is required');
  const dot = state.lastIndexOf('.');
  if (dot === -1) throw new Error('Invalid state token');
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expected) throw new Error('State token signature mismatch');
  const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    u: string;
    t: number;
  };
  if (Date.now() - t > STATE_MAX_AGE_MS) throw new Error('State token expired');
  return u;
}

// ────────────────────────────────────────────────────────────────────────────────
// Strava token refresh + data fetch
// ────────────────────────────────────────────────────────────────────────────────

async function refreshStravaToken(
  userId: string,
  conn: OAuthConnectionRow
): Promise<string> {
  if (!conn.refresh_token) throw new Error('No Strava refresh token stored');
  const refreshToken = decrypt(conn.refresh_token);
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Strava credentials not configured');

  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Strava token refresh failed: ${body}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  await upsertOAuthConnection(
    userId,
    'strava',
    data.access_token,
    data.refresh_token,
    new Date(data.expires_at * 1000),
    conn.provider_account_id ?? undefined
  );

  return data.access_token;
}

async function withStravaToken(
  userId: string,
  fn: (accessToken: string, athleteId: string) => Promise<StravaData>
): Promise<StravaData> {
  const conn = await getOAuthConnection(userId, 'strava');
  if (!conn) throw new Error('Strava not connected. Please authorise via the dashboard.');

  const now = Date.now();
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  let accessToken: string;

  if (expiresAt - now < 60_000) {
    accessToken = await refreshStravaToken(userId, conn);
  } else {
    accessToken = decrypt(conn.access_token);
  }

  return fn(accessToken, conn.provider_account_id ?? '');
}

interface StravaStatsResponse {
  ytd_run_totals: { distance: number; elevation_gain: number };
  ytd_ride_totals: { distance: number; elevation_gain: number };
}

async function fetchAthleteStats(accessToken: string, athleteId: string): Promise<StravaStatsResponse> {
  const resp = await fetch(`${STRAVA_BASE}/athletes/${athleteId}/stats`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Strava stats request failed: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<StravaStatsResponse>;
}

async function fetchYtdFromActivities(
  accessToken: string
): Promise<{ run_km: number; run_elev_m: number; ride_km: number; ride_elev_m: number }> {
  const jan1 = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  let page = 1;
  let run_km = 0, run_elev_m = 0, ride_km = 0, ride_elev_m = 0;

  while (true) {
    const resp = await fetch(
      `${STRAVA_BASE}/athlete/activities?after=${jan1}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!resp.ok) break;
    const acts = (await resp.json()) as Array<{
      type: string;
      distance: number;
      total_elevation_gain: number;
    }>;
    if (!acts.length) break;
    for (const a of acts) {
      if (a.type === 'Run') {
        run_km += (a.distance ?? 0) / 1000;
        run_elev_m += a.total_elevation_gain ?? 0;
      } else if (a.type === 'Ride') {
        ride_km += (a.distance ?? 0) / 1000;
        ride_elev_m += a.total_elevation_gain ?? 0;
      }
    }
    if (acts.length < 100) break;
    page++;
  }

  return { run_km, run_elev_m, ride_km, ride_elev_m };
}

export interface StravaGoalsConfig {
  run_km?: number;
  ride_km?: number;
  elevation_m?: number;
  sport_types?: ('Run' | 'Ride')[];
}

export async function fetchStravaData(
  userId: string,
  goalsConfig: StravaGoalsConfig
): Promise<StravaData> {
  const cacheKey = `strava:${userId}`;
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) return cached.data;

  const data = await withStravaToken(userId, async (accessToken, athleteId) => {
    // Fetch athlete name
    const selfResp = await fetch(`${STRAVA_BASE}/athlete`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const self = (selfResp.ok ? await selfResp.json() : {}) as {
      firstname?: string;
      lastname?: string;
    };
    const athleteName = [self.firstname, self.lastname].filter(Boolean).join(' ') || 'Athlete';

    // Try stats API first; fall back to activity scan if totals are zero
    let run_km = 0, run_elev_m = 0, ride_km = 0, ride_elev_m = 0;
    try {
      const stats = await fetchAthleteStats(accessToken, athleteId);
      run_km = (stats.ytd_run_totals?.distance ?? 0) / 1000;
      run_elev_m = stats.ytd_run_totals?.elevation_gain ?? 0;
      ride_km = (stats.ytd_ride_totals?.distance ?? 0) / 1000;
      ride_elev_m = stats.ytd_ride_totals?.elevation_gain ?? 0;
    } catch (err) {
      logger.warn({ err }, 'Strava stats API failed, falling back to activity scan');
    }

    // Fallback: scan activities if stats look suspiciously zero
    if (run_km === 0 && ride_km === 0) {
      const fallback = await fetchYtdFromActivities(accessToken);
      run_km = fallback.run_km;
      run_elev_m = fallback.run_elev_m;
      ride_km = fallback.ride_km;
      ride_elev_m = fallback.ride_elev_m;
    }

    const sports: ('Run' | 'Ride')[] = goalsConfig.sport_types ?? ['Run', 'Ride'];
    const stats: StravaGoalStat[] = sports.map((sport) =>
      sport === 'Run'
        ? { sport: 'Run', ytdDistanceKm: run_km, ytdElevationM: run_elev_m, goalKm: goalsConfig.run_km }
        : { sport: 'Ride', ytdDistanceKm: ride_km, ytdElevationM: ride_elev_m, goalKm: goalsConfig.ride_km }
    );

    return { athleteName, stats };
  });

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function clearStravaCache(userId?: string): void {
  if (userId) cache.delete(`strava:${userId}`);
  else cache.clear();
}
