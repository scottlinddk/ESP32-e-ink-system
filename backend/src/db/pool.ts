/**
 * The one PostgreSQL connection pool for the process.
 *
 * Repositories take a `Queryable` so the same function runs either on the pool
 * (one statement, autocommit) or on a transaction client. Inside a
 * `withTransaction` callback use only the client you are given: asking the pool
 * for a second connection while holding one can deadlock a small pool.
 */
import { Pool, types as pgTypes, type CustomTypesConfig, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { logger } from '../lib/logger';
import { loadDatabaseConfig, type DatabaseConfig } from './config';
import { classifyDatabaseError } from './errors';

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

const TIMESTAMPTZ_OID = 1184;
/**
 * PostgREST returned timestamptz as ISO 8601 text and the API contract exposes
 * strings. pg would return Date objects, which serialise differently for
 * infinity and cannot be compared with the stored text. Keep ISO strings.
 */
const parseTimestamptz = (value: string): string => {
  // "2026-11-05 10:00:00.123456+00" -> ISO 8601. Anything else (infinity) stays as sent.
  const time = Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(time) ? value : new Date(time).toISOString();
};
const typeParsers = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    oid === TIMESTAMPTZ_OID ? parseTimestamptz : pgTypes.getTypeParser(oid, format as 'text'),
} as unknown as CustomTypesConfig;

export function buildPoolConfig(config: DatabaseConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    // Certificates are always verified (chain and host name) unless TLS is off entirely.
    ssl: config.sslMode === 'disable' ? false : { rejectUnauthorized: true, ...(config.sslCa ? { ca: config.sslCa } : {}) },
    max: config.poolMax,
    idleTimeoutMillis: config.idleTimeoutMs,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    // Client-side backstop in case the network black-holes mid-query.
    query_timeout: config.statementTimeoutMs + 2_000,
    // A request that dies between BEGIN and COMMIT must not hold locks.
    idle_in_transaction_session_timeout: config.statementTimeoutMs,
    application_name: config.applicationName,
    keepAlive: true,
    types: typeParsers,
  };
}

let pool: Pool | null = null;
let closing: Promise<void> | null = null;

/** Lazily creates the pool. Throws DatabaseConfigError when DATABASE_URL is unusable. */
export function getPool(): Pool {
  if (closing) throw new Error('Database pool is shutting down');
  if (!pool) {
    const created = new Pool(buildPoolConfig(loadDatabaseConfig()));
    // An idle client can fail (server restart, network drop). Without a handler
    // that event would crash the process. The pool discards the client itself.
    created.on('error', (error) => {
      logger.error({ reason: classifyDatabaseError(error) ?? 'error', code: (error as { code?: string }).code }, 'Idle database client failed');
    });
    pool = created;
  }
  return pool;
}

/** Runs one statement. Parameters are always bound; never build SQL from input. */
export async function query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
  return getPool().query<R>(text, values);
}

/**
 * Runs `work` in one transaction. Commits when it resolves, rolls back when it
 * throws, and always returns the connection to the pool. A connection whose
 * rollback fails is destroyed rather than reused.
 */
export async function withTransaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      broken = true;
      logger.error({ reason: classifyDatabaseError(rollbackError) ?? 'error' }, 'Database rollback failed; discarding connection');
    }
    throw error;
  } finally {
    client.release(broken ? true : undefined);
  }
}

/** Rejects as soon as `signal` aborts. The statement itself ends on its own (statement_timeout). */
export function withSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(signal.reason ?? new Error('Aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** One cheap statement that proves a connection can be made and used. */
export async function pingDatabase(timeoutMs = 5_000): Promise<void> {
  const timer = AbortSignal.timeout(timeoutMs);
  await withSignal(query('SELECT 1'), timer);
}

/** Drains and closes the pool. Safe to call more than once. */
export function closePool(timeoutMs = 10_000): Promise<void> {
  if (closing) return closing;
  const current = pool;
  if (!current) return Promise.resolve();
  closing = (async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        current.end(),
        new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Database pool close timed out')), timeoutMs); }),
      ]);
    } catch (error) {
      logger.warn({ message: error instanceof Error ? error.message : 'unknown' }, 'Database pool did not close cleanly');
    } finally {
      if (timer) clearTimeout(timer);
      pool = null;
      closing = null;
    }
  })();
  return closing;
}

/** Test hook: forget the pool without waiting for it. */
export function resetPoolForTests(): void {
  pool = null;
  closing = null;
}
