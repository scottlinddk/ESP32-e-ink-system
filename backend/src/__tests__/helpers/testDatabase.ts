/**
 * Isolated PostgreSQL databases for integration tests.
 *
 * TEST_DATABASE_URL must point at a DISPOSABLE server (a CI service container or a local throwaway
 * cluster) as a superuser, or a role that may CREATE DATABASE and CREATE ROLE. Every test file
 * gets its own freshly created database, so nothing here ever touches the application database.
 * The schema is built from the real migrations, and the application role from the real
 * backend/src/db/roles/app-role.sql, so the tests run against the same privileges as production.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

const ROOT = join(__dirname, '..', '..', 'db');
/** The application role's password in test databases only. The role and its password never leave a throwaway server. */
const APP_PASSWORD = 'test-only-app-role-password';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** CI sets this so a missing database fails the build instead of silently skipping the tests. */
export const TEST_DATABASE_REQUIRED = process.env.REQUIRE_TEST_DATABASE === '1';

export interface IsolatedDatabase {
  name: string;
  /** DATABASE_URL for the application role, as the API would be configured. */
  appUrl: string;
  /** Run SQL as the administrator (fixtures, assertions that bypass the API). */
  admin: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<R[]>;
  drop: () => Promise<void>;
}

function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) parsed.username = user;
  if (password) parsed.password = password;
  parsed.search = '';
  return parsed.toString();
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  const name = `eink_test_${process.pid}_${randomBytes(4).toString('hex')}`;

  const maintenance = await connect(TEST_DATABASE_URL);
  await maintenance.query(`CREATE DATABASE "${name}"`);
  const adminUrl = withDatabase(TEST_DATABASE_URL, name);
  const db = await connect(adminUrl);
  try {
    // Roles are cluster-wide and test files run in parallel: serialise their creation.
    await maintenance.query('SELECT pg_advisory_lock(7270001)');
    try {
      // Compatibility roles the migrations GRANT/REVOKE against (Supabase names). Inert, no login.
      await db.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$`);
      // Same order as the Coolify/Pi bootstrap: full file names, sorted (two migrations share 002).
      const dir = join(ROOT, 'migrations');
      for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.sql')).sort()) {
        await db.query(readFileSync(join(dir, file), 'utf8'));
      }
      await db.query(readFileSync(join(ROOT, 'roles', 'app-role.sql'), 'utf8'));
      await db.query(`ALTER ROLE eink_app PASSWORD '${APP_PASSWORD}'`);
    } finally {
      await maintenance.query('SELECT pg_advisory_unlock(7270001)');
    }
  } catch (error) {
    await db.end();
    await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
    throw error;
  }

  return {
    name,
    appUrl: withDatabase(TEST_DATABASE_URL, name, 'eink_app', APP_PASSWORD),
    admin: async (sql, values) => (await db.query(sql, values)).rows,
    drop: async () => {
      await db.end();
      await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await maintenance.end();
    },
  };
}
