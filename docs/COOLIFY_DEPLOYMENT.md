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
   - Required: `CLERK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
     `ENCRYPTION_KEY` (64 hex characters). The process refuses to start without them.
   - `FRONTEND_URL=https://esp32.scottlind.dk` (CORS allow-list)
   - Optional: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (rate limiting is
     disabled without them), `DATABASE_MAINTENANCE_MODE`, and any provider keys you set
     on Vercel. Export them from the Vercel project settings before cutover.
5. Copy each app's **Deploy webhook URL** (Webhooks section).

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

1. Merge, let the workflow publish the images, and confirm both apps are healthy in
   Coolify using a temporary domain.
2. In Clerk, add the new domain to allowed origins/redirects if it differs from today's.
3. Verify: `curl https://<domain>/api/health` returns `{"status":"ok"}`, the dashboard
   loads and signs in, and a device feed request returns an image.
4. Lower DNS TTL, point `esp32.scottlind.dk` at the Coolify server, wait for TLS.
5. Keep Vercel running for a few days as a rollback, then remove `vercel.json`, the
   Vercel origins in `backend/src/app.ts` and the `vercel.json` read in
   `backend/src/__tests__/calendar-build.test.ts`.

## Known differences from Vercel

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
