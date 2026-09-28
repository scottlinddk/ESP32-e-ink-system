# Validation record

Validated locally on Windows and in disposable Linux CI, 2026-09-28. No production
Supabase, Raspberry Pi, DNS, Vercel settings or Investor service was changed.

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
- [Database integration CI](https://github.com/scottlinddk/ESP32-e-ink-system/actions/runs/36427182971)
  passed on native AMD64 (`ubuntu-24.04`) and ARM64 (`ubuntu-24.04-arm`) for
  implementation commit `dc19c5b`. Both jobs initialized the real pinned
  PostgreSQL/PostgREST/Nginx stack, exercised seven-table export/import/verification,
  rejected tampered bundles, nonempty targets and standalone unique-index drift,
  proved rollback after late foreign-key and post-COPY checksum failures, and
  passed real Supabase SDK access/write/cleanup checks. Source rows stayed unchanged.
  These jobs also passed all 66 offline Python tests and shell syntax checks.
- [Application CI](https://github.com/scottlinddk/ESP32-e-ink-system/actions/runs/36427182883)
  passed type checks, all 163 tests and production builds on the same implementation.

## Required before production

Docker, PostgreSQL and Nginx are not installed on this Windows workstation;
container integration was run in CI as linked above. CI uses generated fixture
data and disposable storage, not the actual Pi, source database or production
storage/backup procedures. Its success does not replace the deployment rehearsal.

Rehearse on the actual ARM64 host. Confirm:

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
