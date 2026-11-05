/**
 * Database configuration, read from the environment and validated once.
 *
 * Errors name the variable that is wrong and never echo its value: DATABASE_URL
 * contains the password and must not reach logs or API responses.
 */
import { readFileSync } from 'node:fs';

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

export type DatabaseSslMode = 'disable' | 'verify-full';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** `disable` is for a private network only. `verify-full` checks chain and host name. */
  sslMode: DatabaseSslMode;
  /** PEM bundle that signed the server certificate, for a private CA. Optional. */
  sslCa: string | undefined;
  poolMax: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  applicationName: string;
}

type Env = Record<string, string | undefined>;

/** Parameters that would configure TLS behind DATABASE_SSL's back, or weaken it. */
const FORBIDDEN_URL_PARAMS = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DatabaseConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function sslMode(env: Env): DatabaseSslMode {
  const raw = (env.DATABASE_SSL ?? '').trim().toLowerCase();
  if (raw === '') return 'verify-full';
  if (raw === 'disable' || raw === 'verify-full') return raw;
  // No "require" or "no-verify": encryption without verification is not offered.
  throw new DatabaseConfigError('DATABASE_SSL must be "verify-full" or "disable".');
}

function caBundle(env: Env): string | undefined {
  const inline = env.DATABASE_SSL_CA?.trim();
  const file = env.DATABASE_SSL_CA_FILE?.trim();
  if (inline && file) throw new DatabaseConfigError('Set only one of DATABASE_SSL_CA and DATABASE_SSL_CA_FILE.');
  if (file) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      throw new DatabaseConfigError('DATABASE_SSL_CA_FILE could not be read.');
    }
  }
  // Coolify and .env files often carry a PEM with literal \n sequences.
  return inline ? inline.replace(/\\n/g, '\n') : undefined;
}

export function loadDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new DatabaseConfigError('DATABASE_URL environment variable is required.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseConfigError('DATABASE_URL is not a valid URL (expected postgresql://user:password@host:5432/database).');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError('DATABASE_URL must start with postgresql:// or postgres://.');
  }
  if (!url.hostname) throw new DatabaseConfigError('DATABASE_URL has no host.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new DatabaseConfigError('DATABASE_URL has no database name.');
  const user = decodeURIComponent(url.username);
  if (!user) throw new DatabaseConfigError('DATABASE_URL has no user.');
  if (!url.password) throw new DatabaseConfigError('DATABASE_URL has no password.');
  for (const name of url.searchParams.keys()) {
    if (FORBIDDEN_URL_PARAMS.includes(name.toLowerCase())) {
      throw new DatabaseConfigError(`DATABASE_URL must not contain "${name}". Configure TLS with DATABASE_SSL and DATABASE_SSL_CA.`);
    }
  }

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DatabaseConfigError('DATABASE_URL has an invalid port.');

  const mode = sslMode(env);
  const ca = caBundle(env);
  if (mode === 'disable' && ca) throw new DatabaseConfigError('DATABASE_SSL_CA is set but DATABASE_SSL is "disable".');

  return {
    // IPv6 literals keep their brackets in URL.hostname; pg wants them without.
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    user,
    password: decodeURIComponent(url.password),
    database,
    sslMode: mode,
    sslCa: ca,
    // Small by default: one Node process on a small VPS, and Postgres max_connections is shared.
    poolMax: integer(env, 'DATABASE_POOL_MAX', 5, 1, 50),
    idleTimeoutMs: integer(env, 'DATABASE_IDLE_TIMEOUT_MS', 30_000, 1_000, 3_600_000),
    connectionTimeoutMs: integer(env, 'DATABASE_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
    statementTimeoutMs: integer(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15_000, 500, 300_000),
    applicationName: (env.DATABASE_APPLICATION_NAME ?? 'esp32-eink-api').slice(0, 63),
  };
}
