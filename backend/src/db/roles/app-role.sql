-- Application role for the API's direct PostgreSQL connection (DATABASE_URL).
--
-- Run as the migration/admin role (for example eink_admin), connected to the application
-- database, AFTER the schema migrations. It is idempotent: run it again after every new migration
-- that adds a table, so the role keeps exactly the privileges the API needs.
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/roles/app-role.sql
--
-- It creates NO password. Set one separately, from a secret, never from this file:
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -c "\password eink_app"
--
-- What the role is:    a plain login role. Not a superuser, cannot create databases or roles,
--                      cannot bypass row level security, does not own any table.
-- What it cannot do:   DDL (no CREATE/ALTER/DROP/TRUNCATE), touch the migration_control schema,
--                      read or write tables the API does not use (orders), or delete users.
-- Why the policies:    the API tables have row level security enabled and, since migration 015,
--                      no policy at all. Without a policy a non-owner role sees nothing. The
--                      policies below let ONLY this role in. Row level security is not the access
--                      control: the API enforces ownership, sharing and device-token rules in its
--                      own queries, so this role is trusted with every row of these tables.
--
-- Not needed by the application at runtime: extensions or functions. gen_random_uuid() is built
-- in from PostgreSQL 13 (migration 001 also creates pgcrypto for older servers), and the
-- SECURITY DEFINER trigger functions from migrations 018 and 027 run as their owner.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eink_app') THEN
    CREATE ROLE eink_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Headroom for a rolling deploy: the old and new container each hold up to DATABASE_POOL_MAX (default 5).
ALTER ROLE eink_app CONNECTION LIMIT 12;
-- Backstops in case a client forgets its own timeouts; the API sets tighter ones per connection.
ALTER ROLE eink_app SET statement_timeout = '30s';
ALTER ROLE eink_app SET idle_in_transaction_session_timeout = '30s';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO eink_app', current_database());
END
$$;

-- Dedicated application database: no schema creation for anyone but the owner.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM eink_app;
GRANT USAGE ON SCHEMA public TO eink_app;

-- Start from nothing, then grant exactly what the queries in backend/src/db/repositories use.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM eink_app;

DO $$
DECLARE
  grant_spec record;
BEGIN
  FOR grant_spec IN
    SELECT * FROM (VALUES
      ('users',              'SELECT, INSERT, UPDATE'),
      ('user_preferences',   'SELECT, INSERT, UPDATE'),
      ('api_keys',           'SELECT, INSERT, UPDATE, DELETE'),
      ('devices',            'SELECT, INSERT, UPDATE, DELETE'),
      ('firmware_versions',  'SELECT, INSERT'),
      ('api_usage',          'INSERT'),
      ('custom_webhooks',    'SELECT, INSERT, UPDATE'),
      ('ai_usage_reports',   'SELECT, INSERT, UPDATE'),
      ('device_delivery',    'SELECT, INSERT, UPDATE'),
      ('device_displays',    'SELECT, INSERT, UPDATE'),
      ('user_connections',   'SELECT, INSERT, UPDATE, DELETE'),
      ('device_shares',      'SELECT, INSERT, UPDATE, DELETE'),
      ('shared_items',       'SELECT, INSERT, UPDATE, DELETE')
    ) AS t(table_name, privileges)
  LOOP
    -- A database that has not applied a migration yet simply lacks the table: skip it, re-run later.
    IF to_regclass(format('public.%I', grant_spec.table_name)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO eink_app', grant_spec.privileges, grant_spec.table_name);
    END IF;
  END LOOP;
END
$$;

-- Tables whose migrations enabled row level security without any policy (015, 018, 024, 027, 014):
-- admit this role only. The 001 tables already carry permissive policies.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'custom_webhooks', 'ai_usage_reports', 'device_delivery', 'device_displays',
    'user_connections', 'device_shares', 'shared_items'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS eink_app_all ON public.%I', table_name);
      EXECUTE format('CREATE POLICY eink_app_all ON public.%I FOR ALL TO eink_app USING (true) WITH CHECK (true)', table_name);
    END IF;
  END LOOP;
END
$$;
