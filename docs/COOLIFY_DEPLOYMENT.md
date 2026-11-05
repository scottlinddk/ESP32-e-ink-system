# Deploying to Coolify

Replaces the Vercel hosting (`vercel.json`) with two Docker images that GitHub
Actions builds and Coolify runs. Follows the
[Coolify GitHub Actions guide](https://coolify.io/docs/applications/sources/github/actions).

```
push to main -> checks (ci.yml) -> build + push to GHCR -> Coolify deploy webhooks
```

Coolify never builds from source. It pulls the published images.

| App | Image | Port | Health |
|---|---|---|---|
| Backend (Express API) | `ghcr.io/<owner>/<repo>-backend` | 3001 | `/health` |
| Frontend (Vite SPA, nginx) | `ghcr.io/<owner>/<repo>-frontend` | 8080 | `/healthz` |

`<owner>/<repo>` is lowercased by the workflow (GHCR requires it).

## Routing: one domain, two apps

The browser calls the API at the same origin (`/api/...`, see `frontend/src/lib/api.ts`)
and the backend strips the `/api` prefix itself (`backend/src/app.ts`). Reproduce the
Vercel rewrite with Traefik path routing, no extra proxy needed:

- Frontend app, domain: `https://esp32.scottlind.dk`
- Backend app, domain: `https://esp32.scottlind.dk/api`

Coolify routes the longer path to the backend. Do **not** enable prefix stripping.

## One-time Coolify setup

1. Self-hosted only: Settings > Advanced > enable API access. Create an API token with
   the **Deploy** permission and copy it immediately.
2. Create two **Docker Image** applications (backend, frontend), pointing at the GHCR
   images above, tag `latest`. Set ports and health checks from the table.
3. Private package? Run `docker login ghcr.io` on the server as the user Coolify uses,
   with a token that has `read:packages`. Otherwise make the packages public.
4. Backend environment variables (runtime), carried over from Vercel:
   - Required: `CLERK_SECRET_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY` (64 hex characters,
     **the same value as before**: stored provider keys are encrypted with it). The process
     refuses to start without them. See [Database](#database-postgresql) below; the full list of
     `DATABASE_*` settings is in [DATABASE.md](DATABASE.md). Mark `DATABASE_URL` as a runtime
     variable only (never "available at build time") and never as a frontend variable.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are no longer read. Leave them in place until
     the rollback window has closed (an older image still needs them), then delete them.
   - `FRONTEND_URL=https://esp32.scottlind.dk` (CORS allow-list)
   - Optional: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (rate limiting is
     disabled without them), `DATABASE_MAINTENANCE_MODE`, and any provider keys you set
     on Vercel. Export them from the Vercel project settings before cutover.
5. Copy each app's **Deploy webhook URL** (Webhooks section).

## Database (PostgreSQL)

The API connects straight to PostgreSQL (`DATABASE_URL`, `pg` driver). PostgreSQL is its own Coolify
resource: either Coolify's PostgreSQL database, or `docker-compose.eink-db.yaml` (below). Details of
the persistence layer, the application role and every setting: [DATABASE.md](DATABASE.md).

1. **Network.** Put the database and the backend app on the same Coolify network and use the
   database's internal hostname in `DATABASE_URL`. Do not publish the database port. On a private
   network without TLS set `DATABASE_SSL=disable`; for a TLS-enabled server keep the default
   `verify-full` and add `DATABASE_SSL_CA` if its certificate comes from a private CA. Certificate
   verification is never turned off.
2. **Schema.** A new database gets every file in `backend/src/db/migrations/` (the compose bootstrap
   does this on first start). An existing database gets only the migrations it is missing; they are
   not all safe to re-run. Nothing in the schema changes with this release.
3. **Application role.** The API must not connect as the admin/owner role. As the admin role:

   ```bash
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/roles/app-role.sql
   psql "$ADMIN_DATABASE_URL" -c '\password eink_app'
   ```

   Then `DATABASE_URL=postgresql://eink_app:<password>@<internal-host>:5432/eink`. Keep the admin
   credentials out of the backend app's environment.
4. **Connections.** Each API container holds up to `DATABASE_POOL_MAX` (default 5); a rolling deploy
   runs two for a moment, and the role is limited to 12 connections. The repository's compose file
   sets `max_connections=20`, which is enough. Run a single backend replica.
5. **`docker-compose.eink-db.yaml`.** It still defines the earlier PostgREST (`postgrest`) and nginx
   (`gateway`) services. The API no longer uses them. Leave them running until the rollback window
   has closed (an older backend image talks to them), then remove those two services from the file
   and redeploy the database resource. Do not do this as part of the cutover.

## GitHub configuration

Repository secrets:

| Name | Value |
|---|---|
| `COOLIFY_WEBHOOK_BACKEND` | backend deploy webhook URL |
| `COOLIFY_WEBHOOK_FRONTEND` | frontend deploy webhook URL |
| `COOLIFY_TOKEN` | Coolify API token (Deploy permission) |

Repository variable (public value, inlined into the bundle at build time):

| Name | Value |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_...`) |

The deploy job uses the `production` environment. Add required reviewers there if you
want a manual approval before each deploy.

## Cutover checklist

### A. Before touching production

- [ ] Back up the database: `pg_dump --format=custom --file=eink-$(date +%F).dump "$ADMIN_DATABASE_URL"`
      and confirm it restores into a scratch database. Keep it until the rollback window closes.
- [ ] Copy the current backend environment (Coolify "Environment Variables") somewhere safe. Note
      the **image tag** that is running now (the commit SHA); that is the rollback target.
- [ ] Confirm `ENCRYPTION_KEY` is identical to the running deployment.
- [ ] Apply any missing migrations, then run `app-role.sql` and set the `eink_app` password (see
      [Database](#database-postgresql)). Re-run `app-role.sql` after every future migration that adds a table.
- [ ] Check the role from a scratch shell: `psql "postgresql://eink_app:...@host/eink" -c "select count(*) from users"`
      works, and `-c "create table t(a int)"` and `-c "select * from orders"` are refused.
- [ ] Optional rehearsal: start a second backend app from the new image on a temporary domain with the
      same environment plus `DATABASE_URL`, and run section C against it. Both backends can share the
      database: there is no schema change, so the old and new images are interchangeable on it.

### B. Deploy

- [ ] Set `DATABASE_URL` (runtime only), `DATABASE_SSL`, optionally `DATABASE_POOL_MAX`, on the backend app.
      Keep `SUPABASE_*` for now.
- [ ] Merge and let the workflow publish the image (checks include the PostgreSQL integration tests), or
      redeploy from Coolify.
- [ ] Watch the deploy logs. A bad `DATABASE_URL` fails at start with a message that names the
      variable and never prints it.

### C. Verify

- [ ] `curl -fsS https://<domain>/api/health` returns `{"status":"ok", ...}` (liveness, unchanged).
- [ ] `curl -fsS https://<domain>/api/health/ready` returns `{"status":"ok"}`. A `503` carries a reason:
      `authentication_failed` (wrong user or password, or the role is missing), `tls_error`
      (`DATABASE_SSL` / CA / host name), `unreachable` (host, port or network), `timeout`,
      `too_many_connections`, `not_configured`.
- [ ] Sign in to the dashboard. Devices, saved layouts and shared devices are listed (reads).
- [ ] Change a harmless setting, reload, and see it persisted (writes). Open a preview, so a saved
      provider key decrypts (proves `ENCRYPTION_KEY`).
- [ ] A registered display fetches its frame: `GET /api/device-feed/<id>/frame` with its token returns an
      image, and its heartbeat appears under Devices (token, telemetry and refresh paths).
- [ ] In the database: `select application_name, count(*) from pg_stat_activity group by 1` shows the
      API holding at most `DATABASE_POOL_MAX` connections.
- [ ] Logs show no `Database request failed` and no database URL, password or token anywhere.
- [ ] Then, as before: add the new domain to Clerk if it changed, lower DNS TTL, point
      `esp32.scottlind.dk` at the Coolify server, wait for TLS, and keep Vercel for a few days.

### D. Roll back

The database and its schema are untouched by this change, so rolling back is only about the backend:

1. In Coolify, set the backend image tag to the **previous commit SHA** and redeploy. The older image
   reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and the still-running PostgREST gateway, which is
   why both are kept until the window closes.
2. Check `GET /api/health` and sign in. Nothing needs undoing in PostgreSQL: the `eink_app` role is
   additive and harmless to leave.
3. If the new image wrote data that the old one must see, no conversion is needed: the stored formats
   (including encrypted provider keys) are the same.
4. To roll back the database itself (not normally needed): restore the pre-cutover dump into a fresh
   database and point `DATABASE_URL` at it.

### E. Clean up (after the rollback window, days later)

- [ ] Delete `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the backend app.
- [ ] Remove the `postgrest` and `gateway` services from `docker-compose.eink-db.yaml` and redeploy the
      database resource; delete the service-role JWT secret (`JWT_SECRET`, `AUTHENTICATOR_PASSWORD`) if nothing else uses it.
- [ ] Remove `vercel.json`, the Vercel origins in `backend/src/app.ts` and the `vercel.json` read in
      `backend/src/__tests__/calendar-build.test.ts`.

## Known differences from Vercel

- **Vercel entry.** `backend/api/index.ts` still works with `DATABASE_URL`, but serverless functions open a pool per instance. Treat Vercel as unsupported for this database path (set `DATABASE_POOL_MAX=1` if you ever must).
- **Long-running process.** The API now runs as one Node process, so `node-cron` jobs and
  in-memory caches persist. Run a single replica, or jobs will fire per replica.
- **Rate limiting** reads the first `x-forwarded-for` entry, which a client can prepend
  to. Traefik appends the real address, so this is spoofable. Consider `trust proxy` plus
  `req.ip` in `backend/src/middleware/rateLimit.ts` as a follow-up.
- **Image tags.** Every build is pushed as `latest` and as the commit SHA. For
  rollbacks, set the Coolify app's tag to a previous SHA and redeploy.
- **Firmware.** Devices keep the same feed URL as long as the domain is unchanged.
  Changing the domain requires reflashing or reconfiguring devices.

## Local image check

```bash
docker build -f backend/Dockerfile -t esp32-eink-backend .
docker build -f frontend/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_x -t esp32-eink-frontend .
```
