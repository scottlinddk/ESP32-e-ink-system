import { getSupabaseClient } from './database';

/**
 * Why a database request failed, without any upstream text. The database is
 * PostgREST behind an HTTPS gateway, so most failures fall into one of these.
 */
export type DatabaseFailure =
  | 'token_rejected'
  | 'gateway_challenge'
  | 'gateway_error'
  | 'unreachable'
  | 'not_configured'
  | 'error';

export const DATABASE_FAILURE_HINTS: Record<DatabaseFailure, string> = {
  token_rejected:
    'The database rejected the service token. SUPABASE_SERVICE_ROLE_KEY must be the token from the Pi backend.env, signed with its JWT_SECRET.',
  gateway_challenge:
    'The database gateway answered with a bot-protection challenge page. Server-to-server requests to SUPABASE_URL are being challenged (for example by Cloudflare Bot Fight Mode).',
  gateway_error:
    'The database gateway returned HTML instead of PostgREST JSON. Check the reverse proxy routes and reload its current configuration, including the device_displays route.',
  unreachable:
    'The database gateway could not be reached. Check the tunnel, the Raspberry Pi and SUPABASE_URL.',
  not_configured: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.',
  error: 'The database check failed for another reason. See the function logs.',
};

const TOKEN_ERROR_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);

/**
 * Recognises transport and authentication failures from the database. Returns
 * null for anything else, such as an ordinary query or validation error.
 */
export function classifyDatabaseError(err: unknown): DatabaseFailure | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, message } = err as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';

  if (typeof code === 'string' && TOKEN_ERROR_CODES.has(code)) return 'token_rejected';
  if (/just a moment|challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform\//i.test(text)) {
    return 'gateway_challenge';
  }
  if (/<!doctype html|<html/i.test(text)) return 'gateway_error';
  if (/fetch failed|econnrefused|enotfound|etimedout|econnreset|network/i.test(text)) {
    return 'unreachable';
  }
  return null;
}

export type DatabaseCheck = { ok: true } | { ok: false; reason: DatabaseFailure };

const CACHE_MS = 30_000;
let cached: { at: number; result: DatabaseCheck } | null = null;

export function resetDatabaseHealthCache(): void {
  cached = null;
}

/**
 * One cheap read that exercises the URL, the gateway and the token. The result
 * is cached briefly so the public endpoint cannot be used to hammer the Pi.
 */
export async function checkDatabase(now: number = Date.now()): Promise<DatabaseCheck> {
  if (cached && now - cached.at < CACHE_MS) return cached.result;

  let result: DatabaseCheck;
  try {
    const { error } = await getSupabaseClient()
      .from('users')
      .select('id')
      .limit(1)
      .abortSignal(AbortSignal.timeout(5000));
    result = error ? { ok: false, reason: classifyDatabaseError(error) ?? 'error' } : { ok: true };
  } catch (err) {
    const missingConfig = err instanceof Error && /must be set/i.test(err.message);
    result = {
      ok: false,
      reason: missingConfig ? 'not_configured' : classifyDatabaseError(err) ?? 'error',
    };
  }

  cached = { at: now, result };
  return result;
}
