import { pingDatabase } from '../db/pool';
import { classifyDatabaseError, DATABASE_FAILURE_HINTS, type DatabaseFailure } from '../db/errors';

// Re-exported so routes and middleware keep a single import point for health concerns.
export { classifyDatabaseError, DATABASE_FAILURE_HINTS };
export type { DatabaseFailure };

export type DatabaseCheck = { ok: true } | { ok: false; reason: DatabaseFailure };

const CACHE_MS = 30_000;
let cached: { at: number; result: DatabaseCheck } | null = null;

export function resetDatabaseHealthCache(): void {
  cached = null;
}

/**
 * One cheap statement that exercises DATABASE_URL, TLS, the role and the pool. The
 * result is cached briefly so the public endpoint cannot be used to hammer the database.
 */
export async function checkDatabase(now: number = Date.now()): Promise<DatabaseCheck> {
  if (cached && now - cached.at < CACHE_MS) return cached.result;

  let result: DatabaseCheck;
  try {
    await pingDatabase(5000);
    result = { ok: true };
  } catch (error) {
    result = { ok: false, reason: classifyDatabaseError(error) ?? 'error' };
  }

  cached = { at: now, result };
  return result;
}
