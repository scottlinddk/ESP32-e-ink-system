import { DatabaseConfigError } from './config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for a canonical UUID. Guards ids that reach a uuid column from a URL or body. */
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Raised when a device is absent, or not visible to the caller. Never reveals which. */
export class DeviceNotFound extends Error {
  readonly statusCode = 404;
}

/** A generic message for the client that still carries the original failure for logs and classification. */
export function withCause(message: string, cause: unknown): Error & { cause: unknown } {
  return Object.assign(new Error(message), { cause });
}

/** SQLSTATE of a pg error, if any. */
export function pgCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** The statement failed because a table does not exist (a migration is not applied yet). */
export const isMissingTable = (error: unknown): boolean => pgCode(error) === '42P01';

/** The statement failed because a column does not exist; optionally matching its name. */
export function isMissingColumn(error: unknown, columns?: RegExp): boolean {
  if (pgCode(error) !== '42703') return false;
  return columns ? columns.test(String((error as { message?: unknown }).message ?? '')) : true;
}

/**
 * Why a database request failed, without any server text. Coarse on purpose:
 * it is shown in logs and on the readiness endpoint, never the raw error.
 */
export type DatabaseFailure =
  | 'not_configured'
  | 'authentication_failed'
  | 'tls_error'
  | 'unreachable'
  | 'timeout'
  | 'too_many_connections'
  | 'error';

export const DATABASE_FAILURE_HINTS: Record<DatabaseFailure, string> = {
  not_configured:
    'DATABASE_URL is missing or invalid. See backend/.env.example for the expected format and DATABASE_SSL options.',
  authentication_failed:
    'PostgreSQL rejected the credentials or the role may not connect. Check the user and password in DATABASE_URL and that the application role exists (backend/src/db/roles/app-role.sql).',
  tls_error:
    'The TLS handshake with PostgreSQL failed. Check DATABASE_SSL, DATABASE_SSL_CA and that the certificate matches the host name in DATABASE_URL. Use DATABASE_SSL=disable only on a private network without TLS.',
  unreachable:
    'PostgreSQL could not be reached. Check the host and port in DATABASE_URL, that the database resource is running, and that both Coolify resources share a network.',
  timeout:
    'The database did not answer in time. Check load on the database server and DATABASE_CONNECTION_TIMEOUT_MS / DATABASE_STATEMENT_TIMEOUT_MS.',
  too_many_connections:
    'PostgreSQL has no free connections. Lower DATABASE_POOL_MAX or raise max_connections on the database.',
  error: 'The database check failed for another reason. See the API logs.',
};

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECONNABORTED']);
/** Node TLS verification and handshake error codes. pg surfaces them unchanged. */
const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(VERIFY_LEAF_SIGNATURE|GET_ISSUER_CERT)|HOSTNAME_MISMATCH|ERR_OSSL)/;

/**
 * Recognises connection, authentication, TLS and timeout failures. Returns null
 * for anything else, such as a constraint violation or a bug in a query, so
 * those keep their normal handling instead of being reported as an outage.
 */
export function classifyDatabaseError(error: unknown): DatabaseFailure | null {
  if (error instanceof DatabaseConfigError) return 'not_configured';
  if (typeof error !== 'object' || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  const sqlState = typeof code === 'string' ? code : '';

  // Server-reported SQLSTATE classes.
  if (sqlState === '28P01' || sqlState === '28000') return 'authentication_failed';
  if (sqlState === '53300') return 'too_many_connections';
  if (sqlState === '57014') return 'timeout';
  if (sqlState.startsWith('08') || sqlState === '57P01' || sqlState === '57P02' || sqlState === '57P03') return 'unreachable';
  // Node socket and TLS codes.
  if (sqlState === 'ETIMEDOUT') return 'timeout';
  if (NETWORK_CODES.has(sqlState)) return 'unreachable';
  if (TLS_CODE.test(sqlState)) return 'tls_error';
  // pg raises these without a code.
  if (/timeout exceeded when trying to connect|query read timeout/i.test(text)) return 'timeout';
  if (/the server does not support ssl connections/i.test(text)) return 'tls_error';
  if (/connection terminated|connection ended unexpectedly|cannot use a pool after calling end|client has encountered a connection error/i.test(text)) return 'unreachable';
  return null;
}
