# Validation record

Validated locally on Windows, 2026-09-28. No live Supabase, Raspberry Pi, DNS,
Vercel deployment or Investor service was accessed or changed.

## Completed

- `npm run typecheck`: all workspaces passed.
- `npm test`: 163 application tests passed, including 14 new database-client and
  maintenance-mode tests. The database-client tests exercise the actual Supabase
  SDK with mocked HTTP responses, including custom `/rest/v1` routing,
  authorization headers and encrypted composite upserts.
- `npm run build`: frontend and backend production builds passed.
- `python -m unittest discover -s infra/raspberry-pi/tests -v`: 37 offline migration
  safety tests passed using the pinned psycopg dependency. These cover unique-index drift, changed
  bundle data/manifests, drift, wrong targets, nonempty targets, refusal before
  writes and transactional control flow. Database connections are mocked; this
  is not evidence of a real PostgreSQL restore or rollback.
- `python -m unittest discover -s infra/raspberry-pi -p 'test_*.py' -v`:
  29 tests passed (5 credential tests and 24 storage/startup tests), including
  Investor backing-storage aliases, root SSD identity, mount protection,
  migration/credential directories, backup destinations and isolated recovery.
  Together with the migration suite, 66 offline Python safety tests passed.
- Compose YAML parsed locally; project isolation, loopback gateway publication,
  absence of a host database port, platform/resource limits were inspected.
- `node --check infra/raspberry-pi/smoke.mjs` passed; its help command ran.
- Bash syntax checks passed for all six shell scripts using the bundled Git GNU
  Bash executable.
- `git diff --check` passed for tracked changes.

## Required before production

Docker, PostgreSQL and Nginx are not installed in this workstation environment.
Container startup, Linux operating procedures and database integration were
therefore **not run here**; Bash syntax checks do not establish runtime behavior.
The companion `test-stack.sh` and `pi-database.yml` workflow provide disposable
native AMD64 and ARM64 Docker exercises; their presence does not mean that CI has already run or passed.

Run the integration workflow, then rehearse on the actual ARM64 host. Confirm:

1. Native ARM64 image pulls, clean initialization (including both 002 migrations),
   SQL permissions, authenticated API access and denied anonymous/invalid access.
2. Real source inspection against the live Supabase schema; explicit resolution
   of schema drift, extra table dependencies and Storage/firmware URLs.
3. A complete export/import/verify cycle with exact counts and full-row hashes;
   refusal of wrong/nonempty targets and rollback on failed COPY/verification.
4. A backup restored into the isolated recovery project and verified through SQL
   and the SDK; retained copies and secrets recoverable off-device.
5. HTTPS access from the deployed backend, existing provider-key decryption with
   the original AES key, and actual UI/device workflows after the cutover freeze.
6. Investor availability and unchanged Tailscale routing; combined peak memory,
   CPU, SSD space/I/O, thermal behavior and recovery following reboot/outage.

Use [the runbook](../../docs/RASPBERRY_PI_DATABASE_MIGRATION.md) for the ordering,
write freeze, rollback boundaries and operating procedures. Do not declare the
production migration complete based on unit tests or `/health` alone.
