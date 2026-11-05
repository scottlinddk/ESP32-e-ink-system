# Database access

The API talks to PostgreSQL **directly**, through the `pg` driver and one small connection
pool. There is no REST gateway (PostgREST, Supabase, nginx) between the API and the database.
This is the current deployment path. The earlier Supabase and Raspberry Pi/PostgREST
instructions are kept only as history (see [Historical documents](#historical-documents)).

## How it works

```
routes/            HTTP, Clerk auth (requireAuth), request validation
services/          business rules: sharing permissions, device-token flows, encryption of provider keys
db/repositories/   every SQL statement, parameterized, one file per area
db/pool.ts         the shared pool, withTransaction(), graceful shutdown
db/config.ts       DATABASE_URL / TLS / pool validation (never echoes values)
db/errors.ts       SQLSTATE and network error classification, DeviceNotFound, isUuid
db/roles/          app-role.sql: the least-privilege role the API connects as
db/migrations/     the schema (unchanged)
```

- **SQL stays in `db/repositories/`.** Routes and services never build SQL. A test fails if SQL or
  `pg` appears elsewhere, and another fails if a repository interpolates anything into SQL text
  that is not a reviewed fragment.
- **Everything is parameterized.** Values are always bound (`$1`, `$2`, ...). The only text built
  dynamically is column lists (preferences, telemetry, device display), and those names come from
  an allow-list in code; an unknown key is rejected before any SQL runs. `jsonb` columns are
  serialised explicitly because `pg` would otherwise turn a JavaScript array into a PostgreSQL array.
- **One pool, small by default** (`DATABASE_POOL_MAX=5`). Repository functions take an optional
  `Queryable`, so the same function runs on the pool (one statement) or on a transaction client.
  Inside `withTransaction` use only the client you are given.
- **Timestamps are ISO 8601 strings** (`2026-11-05T10:00:00.123Z`), as the REST gateway returned
  them. `timestamptz` values are parsed to strings by the pool, not to `Date` objects.
- **Encryption is unchanged.** Provider keys are encrypted/decrypted in `services/database.ts` with
  `ENCRYPTION_KEY` (AES-256-GCM, same format). Existing rows decrypt without migration.

## Authorization is in the API, not in the database

The API connects as one role that can read and write every row of the tables it uses. Row level
security is **not** the access control (the service-role key bypassed it before, too). Each rule
is enforced by the statement itself, with the caller's id taken from the verified Clerk session:

| Rule | Where it is enforced |
|---|---|
| A user reads and writes only their own rows | `user_id = $n` / `owner_id = $n` in every repository query |
| Device access (owner / editor / viewer / stranger) | `resolveDeviceAccess`: device owner lookup, then a share row that was granted **by the current owner**. Strangers and missing devices both give 404 |
| Sharing needs an accepted connection | `lockAcceptedConnection` (`FOR SHARE`) inside the same transaction as the share or item insert. A disconnect deletes the connection row first, so it waits for an in-flight share and then removes it. No share survives its connection |
| Disconnecting ends all shares and pending items | one transaction (`removeConnection`) |
| Accepting a shared item | one transaction: item row locked `FOR UPDATE`, device updated, item marked accepted. A failure leaves the item pending; a double click applies it once |
| Device tokens | only a SHA-256 hash is stored. `authenticateDevice` is one query joining `device_delivery` to `devices` on the owner, so a transferred device rejects its old token. Rotation, revocation, refresh requests and heartbeats are all scoped by device + owner + current hash |
| Issuing a device token | the insert selects from `devices` with `user_id = owner` in the same statement, so a device reassigned mid-request gets no token |
| Integration tokens (webhook, AI usage) | writes are filtered on the current token hash |
| Device display settings | compare-and-swap on `(owner_id, revision)`; the composite foreign key to `devices(id, user_id)` rejects a non-owner (23503, reported as 404) |
| Default device | one `UPDATE ... WHERE EXISTS (device owned by user)` |

`backend/src/__tests__/database-integration.test.ts` proves these against a real PostgreSQL (see
[Tests](#tests)).

## Environment variables

Runtime only. Never expose them to the frontend, a build argument or git.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | `postgresql://eink_app:<password>@<host>:5432/<db>`. Percent-encode special characters in the password. `sslmode=` and other TLS parameters are rejected. |
| `DATABASE_SSL` | `verify-full` | `verify-full` verifies chain and host name. `disable` is plain TCP, for a private network between two containers. There is no `require`/`no-verify`; certificate verification is never switched off. |
| `DATABASE_SSL_CA` / `DATABASE_SSL_CA_FILE` | none | PEM of the private CA that signed the server certificate (one of the two). |
| `DATABASE_POOL_MAX` | `5` | Maximum connections for this process (1 to 50). A rolling deploy briefly runs two API containers. |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | Close idle connections after this long. |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` | Give up waiting for a connection. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `15000` | Server-side statement timeout; idle-in-transaction uses the same limit. |
| `ENCRYPTION_KEY` | required | **Unchanged.** 64 hex characters. |
| `CLERK_SECRET_KEY` | required | Unchanged. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are no longer read. They can stay set while a
rollback to the previous image is still possible, and should be removed afterwards.

The process refuses to start if `DATABASE_URL` or the TLS/pool settings are invalid. The message names
the variable and never contains its value. The URL, password and tokens are never logged.

## Database roles

Keep two kinds of credentials apart:

| Role | Used by | Can |
|---|---|---|
| `eink_admin` (owner / migration role) | you, from a trusted shell; migrations and `app-role.sql` | everything in the database |
| `eink_app` | the API, via `DATABASE_URL` | the verbs the API needs on the tables it uses, nothing else |

`eink_app` is a plain login role: not a superuser, cannot create databases or roles, cannot bypass
row level security, owns nothing, cannot run DDL. Its grants are exactly the ones in
[`backend/src/db/roles/app-role.sql`](../backend/src/db/roles/app-role.sql). It cannot touch
`orders` (unused), delete users, or read `api_usage`.

```bash
# 1. As the admin role, connected to the application database, after the migrations:
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/roles/app-role.sql

# 2. Set its password interactively (prompts, nothing lands in shell history or logs):
psql "$ADMIN_DATABASE_URL" -c '\password eink_app'
```

Run step 1 again after any migration that adds a table. It is idempotent and re-applies exactly the
listed grants (a table that is not there yet is skipped).

### What the schema still requires

- **Roles `anon`, `authenticated`, `service_role`.** Migrations 015, 018, 024, 027 and 014
  `GRANT`/`REVOKE` against these Supabase role names. They must **exist** when the migrations run
  (the Coolify/Pi bootstrap in `infra/raspberry-pi/init/01-bootstrap.sh` creates inert `NOLOGIN` copies).
  The API does not use them at runtime.
- **Extension `pgcrypto`** (created by migration 001). Only for PostgreSQL older than 13; from 13
  `gen_random_uuid()` is built in. The application SQL calls no extension function.
- **Functions and triggers** from the migrations stay in place: `update_updated_at_column`, and
  the `SECURITY DEFINER` functions `clear_device_display_on_transfer` and
  `clear_device_shares_on_transfer`. Triggers fire for any role; the application role needs no
  `EXECUTE` on them.
- **No Supabase-managed schemas** (`auth`, `storage`, `extensions`, `realtime`) are referenced.
- Row level security stays enabled on the tables; `app-role.sql` adds a policy that admits only `eink_app`
  to the tables that had none.

## Failure handling

- `GET /health` is liveness only and never touches the database; its response is unchanged. The
  container health check uses it, so a database outage does not restart a healthy API.
- `GET /health/ready` (and its alias `GET /health/db`) runs `SELECT 1`, cached for 30 s, and returns
  `200 {"status":"ok"}` or `503 {"status":"error","reason":"..."}`. Reasons: `not_configured`,
  `authentication_failed`, `tls_error`, `unreachable`, `timeout`, `too_many_connections`, `error`.
  Never server text, hosts or credentials.
- Connection, authentication, TLS and timeout failures in any route become `503 Database is
  temporarily unavailable` with a coarse reason and an operator hint in the log.
- A broken idle connection is logged (sanitized) and discarded; it cannot crash the process.
- `SIGTERM`/`SIGINT`: stop accepting requests, let in-flight ones finish, drain the pool, exit
  (hard limit 8 s, inside Docker's default 10 s stop timeout).

## Tests

```bash
# unit tests only (integration tests are skipped without a database)
npm test -w backend

# everything, including SQL, privileges, transactions and sharing, against a DISPOSABLE server
docker run --rm -d --name eink-test-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm test -w backend
```

`TEST_DATABASE_URL` must be a superuser (or a role that may `CREATE DATABASE` and `CREATE ROLE`) on a
throwaway server. Each test file creates its own database from the real migrations and
`app-role.sql`, connects as `eink_app`, and drops the database afterwards. It never touches the
database named in `DATABASE_URL`. CI runs a PostgreSQL 17 service container with
`REQUIRE_TEST_DATABASE=1`, so a missing database fails the build instead of skipping the tests.

## Historical documents

These describe how the data got to its current home and are **not** the way to deploy now:

- [`RASPBERRY_PI_DATABASE_MIGRATION.md`](RASPBERRY_PI_DATABASE_MIGRATION.md) and `infra/raspberry-pi/`:
  the Pi + PostgREST plan (its `smoke.mjs` used the Supabase SDK, which is no longer installed).
  Its `init/` bootstrap is still mounted by `docker-compose.eink-db.yaml`.
- [`SETUP_TRACK_A.md`](SETUP_TRACK_A.md): the original Supabase-based local setup.
- Migration files and `backend/src/db/bootstrap/all_migrations.sql`: still the schema. The combined file
  is for an **empty** database only (not idempotent).
