# Raspberry Pi database migration

Start with the [migration runbook](../../docs/RASPBERRY_PI_DATABASE_MIGRATION.md)
and [validation record](VALIDATION.md). This package replaces the hosted database
with PostgreSQL 17 and PostgREST while retaining the current app and Clerk login.

| File | Purpose |
| --- | --- |
| `compose.yaml` | Separate ARM64 stack; only loopback port 3080 is published |
| `preflight.sh`, `start-postgres.sh` | Verify SSD identity, storage separation and host capacity |
| `memory_budget.py` | Check the 4 GB host's total/available RAM and existing container growth allowance |
| `generate-secrets.py` | Create private database credentials and backend service JWT |
| `migrate.py` | Inspect source; export, atomically import and verify all nine app tables |
| `smoke.mjs` | Test authentication and real Supabase SDK operations |
| `backup.sh`, `restore.sh` | Create checksummed backups and rehearse isolated recovery |
| `systemd/`, `cloudflared.yml.example` | Separate backup schedule and HTTPS tunnel |
| `test-stack.sh` | Disposable Linux Docker integration test; never targets production |

Investor retains its database, Tailscale routes and private storage. E-ink uses
`/srv/esp32-eink`, never `/srv/investor`. Confirm the Pi's real SSD layout first.
Preserve the existing backend `ENCRYPTION_KEY` when moving encrypted provider keys.
Keep Supabase until the rehearsal, cutover checks and off-device recovery pass.

The default profile targets the confirmed Pi 4B with 4 GB RAM and a 500 GB SSD:
800 MiB of steady e-ink memory ceilings including the tunnel. The application
stays on Vercel and reaches the Pi through Cloudflare Tunnel. Preflight must
still verify the actual disk, usable memory and Investor load before deployment.
