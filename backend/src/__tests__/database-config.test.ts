import { describe, expect, it } from 'vitest';
import { DatabaseConfigError, loadDatabaseConfig } from '../db/config';
import { buildPoolConfig } from '../db/pool';

const URL_OK = 'postgresql://eink_app:s3cret%40pw@db.internal:5433/eink';
const env = (extra: Record<string, string | undefined> = {}) => ({ DATABASE_URL: URL_OK, ...extra });

describe('DATABASE_URL validation', () => {
  it('parses host, port, decoded credentials and database without keeping the URL', () => {
    const config = loadDatabaseConfig(env());
    expect(config).toMatchObject({ host: 'db.internal', port: 5433, user: 'eink_app', password: 's3cret@pw', database: 'eink' });
    expect(Object.values(config).some((value) => value === URL_OK)).toBe(false);
  });

  it.each([
    [undefined, /DATABASE_URL environment variable is required/],
    ['', /required/],
    ['not a url', /not a valid URL/],
    ['mysql://u:p@h/db', /postgresql:\/\//],
    ['postgresql://u:p@h', /no database/],
    ['postgresql://:p@h/db', /no user/],
    ['postgresql://u@h/db', /no password/],
  ])('rejects %j', (value, message) => {
    expect(() => loadDatabaseConfig({ DATABASE_URL: value })).toThrow(DatabaseConfigError);
    expect(() => loadDatabaseConfig({ DATABASE_URL: value })).toThrow(message);
  });

  it('never puts the password or URL into an error message', () => {
    for (const bad of ['postgresql://u:topsecret@h/db?sslmode=no-verify', 'postgresql://u:topsecret@h:99999/db']) {
      try { loadDatabaseConfig({ DATABASE_URL: bad }); throw new Error('should have thrown'); }
      catch (error) { expect((error as Error).message).not.toMatch(/topsecret/); }
    }
  });

  it('refuses TLS options in the URL so DATABASE_SSL is the only switch', () => {
    for (const param of ['sslmode=disable', 'sslmode=no-verify', 'ssl=true', 'sslrootcert=/x', 'uselibpqcompat=true']) {
      expect(() => loadDatabaseConfig({ DATABASE_URL: `${URL_OK}?${param}` })).toThrow(/DATABASE_SSL/);
    }
  });
});

describe('pool and TLS settings', () => {
  it('uses a small pool and conservative timeouts by default', () => {
    expect(loadDatabaseConfig(env())).toMatchObject({
      poolMax: 5, idleTimeoutMs: 30_000, connectionTimeoutMs: 5_000, statementTimeoutMs: 15_000, sslMode: 'verify-full',
    });
  });

  it('is configurable and bounded', () => {
    expect(loadDatabaseConfig(env({ DATABASE_POOL_MAX: '3', DATABASE_STATEMENT_TIMEOUT_MS: '2000' }))).toMatchObject({ poolMax: 3, statementTimeoutMs: 2000 });
    for (const [name, value] of [['DATABASE_POOL_MAX', '0'], ['DATABASE_POOL_MAX', '500'], ['DATABASE_POOL_MAX', 'x'], ['DATABASE_CONNECTION_TIMEOUT_MS', '1']]) {
      expect(() => loadDatabaseConfig(env({ [name]: value }))).toThrow(new RegExp(name));
    }
  });

  it('verifies certificates by default and when explicitly requested', () => {
    for (const config of [loadDatabaseConfig(env()), loadDatabaseConfig(env({ DATABASE_SSL: 'verify-full' }))]) {
      expect(buildPoolConfig(config).ssl).toEqual({ rejectUnauthorized: true });
    }
  });

  it('passes a private CA to the verifier instead of turning verification off', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----';
    const fromEscaped = loadDatabaseConfig(env({ DATABASE_SSL_CA: ca.replace(/\n/g, '\\n') }));
    expect(buildPoolConfig(fromEscaped).ssl).toEqual({ rejectUnauthorized: true, ca });
  });

  it('allows plain TCP only when DATABASE_SSL=disable is set explicitly', () => {
    expect(buildPoolConfig(loadDatabaseConfig(env({ DATABASE_SSL: 'disable' }))).ssl).toBe(false);
  });

  it.each(['require', 'no-verify', 'prefer', 'true'])('offers no unverified-TLS mode (%s)', (mode) => {
    expect(() => loadDatabaseConfig(env({ DATABASE_SSL: mode }))).toThrow(/verify-full/);
  });

  it('rejects contradictory TLS settings', () => {
    expect(() => loadDatabaseConfig(env({ DATABASE_SSL: 'disable', DATABASE_SSL_CA: 'x' }))).toThrow(/disable/);
    expect(() => loadDatabaseConfig(env({ DATABASE_SSL_CA: 'x', DATABASE_SSL_CA_FILE: '/y' }))).toThrow(/only one/);
    expect(() => loadDatabaseConfig(env({ DATABASE_SSL_CA_FILE: '/definitely/not/here.pem' }))).toThrow(/could not be read/);
  });

  it('sets timeouts that stop a stuck statement or transaction', () => {
    const pool = buildPoolConfig(loadDatabaseConfig(env({ DATABASE_POOL_MAX: '4' })));
    expect(pool).toMatchObject({
      max: 4, statement_timeout: 15_000, idle_in_transaction_session_timeout: 15_000, connectionTimeoutMillis: 5_000, application_name: 'esp32-eink-api',
    });
    expect(pool.query_timeout).toBeGreaterThan(15_000);
  });

  it('parses timestamptz as ISO 8601 strings, as the REST gateway returned them', () => {
    const parse = (buildPoolConfig(loadDatabaseConfig(env())).types as unknown as { getTypeParser: (oid: number) => (value: string) => unknown }).getTypeParser(1184);
    expect(parse('2026-11-05 10:00:00.123456+00')).toBe('2026-11-05T10:00:00.123Z');
    expect(parse('2026-11-05 12:00:00+02')).toBe('2026-11-05T10:00:00.000Z');
    expect(parse('infinity')).toBe('infinity');
  });
});
