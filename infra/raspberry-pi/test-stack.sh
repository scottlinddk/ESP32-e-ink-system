#!/usr/bin/env bash
# Real Docker/SQL/SDK integration test with generated, disposable fixture data.
# Runs on local x86_64/ARM64 Linux; does not connect to a Pi or Supabase.
set +x
set -euo pipefail
umask 077

die() { printf 'Integration test failed: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || die 'Use a Linux Docker test host (the GitHub Actions jobs supply one).'
case "$(uname -m)" in
  x86_64) test_platform=linux/amd64 ;;
  aarch64) test_platform=linux/arm64 ;;
  *) die 'Use a native x86_64 or ARM64 Linux Docker test host.' ;;
esac
for tool in docker python3 node timeout; do command -v "$tool" >/dev/null || die "Missing $tool"; done
[[ -z ${DOCKER_HOST:-} || ${DOCKER_HOST:-} == unix://* ]] || die 'Refusing a remote Docker daemon.'
[[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') == unix://* ]] || die 'Refusing a remote Docker context.'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_dir=$(cd -- "$script_dir/../.." && pwd -P)
[[ ! -L "$repo_dir/.validation" ]] || die 'Validation directory must not be a symlink.'
mkdir -p "$repo_dir/.validation"
stage=$(mktemp -d "$repo_dir/.validation/eink-ci.XXXXXXXX")
project="eink-ci-$(basename "$stage" | tr '[:upper:].' '[:lower:]-')-$$"

# Never inherit production credentials/paths into this disposable project.
unset POSTGRES_PASSWORD AUTHENTICATOR_PASSWORD JWT_SECRET POSTGRES_IMAGE POSTGREST_IMAGE NGINX_IMAGE
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES
export DATA_DIR="$stage/postgres" MIGRATION_WORK_DIR="$stage/work" PG_CONFIG_DIR="$stage/pgconfig"
# The disposable named volume bypasses production SSD wrappers; satisfy only
# Compose interpolation and never inherit an actual host's storage identity.
export STORAGE_MOUNT=/ STORAGE_UUID=ci-disposable-fixture
mkdir -m 0700 "$DATA_DIR" "$MIGRATION_WORK_DIR" "$PG_CONFIG_DIR"
python3 "$script_dir/generate-secrets.py" --output-dir "$stage" --ttl-days 1

# Compose >=2.24.4 supports !override. A project-scoped test volume is removed
# by the trap; fixture exports/configuration stay private under .validation.
cat > "$stage/override.yaml" <<YAML
services:
  postgres:
    platform: $test_platform
    volumes: !override
      - ci-data:/var/lib/postgresql/data
      - $script_dir/init:/docker-entrypoint-initdb.d:ro
      - $repo_dir/backend/src/db/migrations:/migrations:ro
  postgrest:
    platform: $test_platform
  gateway:
    platform: $test_platform
  tools:
    image: $project-tools:local
    platform: $test_platform
    user: "$(id -u):$(id -g)"
volumes:
  ci-data:
YAML
compose=(docker compose --project-name "$project" --env-file "$stage/.env" -f "$script_dir/compose.yaml" -f "$stage/override.yaml")
cleanup() {
  status=$?
  trap - EXIT INT TERM
  # This random test project is the only target. No system-wide prune/restart.
  timeout 60 "${compose[@]}" down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1 || true
  printf 'Disposable test project removed. Private fixture files: %s\n' "$stage"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The production gateway bind is kept, so fail before changing anything if busy.
python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 3080))
PY
"${compose[@]}" config --quiet
# Startup/backup guards consume this extension from real Compose JSON. Inspect
# only its harmless fixture values; never print the rendered secret-bearing config.
"${compose[@]}" config --format json | python3 -c '
import json, sys
config = json.load(sys.stdin)
storage = config.get("x-eink-storage", {})
if storage.get("mount") != "/" or storage.get("uuid") != "ci-disposable-fixture":
    raise SystemExit("Compose did not preserve the expected storage identity extension")
if "PGRST_DB_ANON_ROLE" in config["services"]["postgrest"]["environment"]:
    raise SystemExit("PostgREST must not map requests to an anonymous role")
print("PASS: Compose JSON retains the storage identity extension.")
'
timeout 300 "${compose[@]}" build tools
timeout 180 "${compose[@]}" up -d --wait --wait-timeout 120 postgres

# Restrict both fixture connections to this test's private container hostname.
python3 - "$stage" <<'PY'
from pathlib import Path
import sys
stage = Path(sys.argv[1])
values = dict(line.split('=', 1) for line in (stage / '.env').read_text().splitlines() if line and not line.startswith('#'))
config = stage / 'pgconfig'
(config / 'pg_service.conf').write_text('''[eink-ci-source]
host=postgres
port=5432
dbname=eink_source
user=eink_admin
sslmode=disable
connect_timeout=10

[eink-target]
host=postgres
port=5432
dbname=eink
user=eink_admin
sslmode=disable
connect_timeout=10
''')
(config / 'pgpass').write_text('postgres:5432:*:eink_admin:' + values['POSTGRES_PASSWORD'] + '\n')
for path in config.iterdir():
    path.chmod(0o600)
PY

"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U eink_admin -d postgres -c 'CREATE DATABASE eink_source'
# Supabase compatibility roles created by target bootstrap are cluster-wide;
# both fixture databases therefore apply the unchanged migrations through 020.
"${compose[@]}" exec -T postgres bash -euc 'export LC_ALL=C; for migration in /migrations/*.sql; do psql -X -v ON_ERROR_STOP=1 -U eink_admin -d eink_source -f "$migration"; done'
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U eink_admin -d eink_source <<'SQL'
INSERT INTO users (id, email, display_name) VALUES ('00000000-0000-4000-8000-000000000001', 'fixture@example.invalid', E'Unicode æøå, "quotes"\nand newline');
INSERT INTO user_preferences (id, user_id, layout) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '{"nested":[null,false,1.25],"label":"æøå"}');
UPDATE user_preferences SET
  display_profile = '{"width":320,"height":240,"rotation":90,"colorMode":"bw"}',
  news_source = 'rss', news_feed_url = 'https://example.invalid/feed.xml?x=1&lang=da', news_item_limit = 7,
  show_custom_text = true, custom_text = E'Køkken, "quotes"\nand newline',
  show_custom_image = true, custom_image = '{"width":8,"height":2,"pixels":"/wA=","fit":"contain"}',
  show_calendar = true, calendar_timezone = 'Europe/Copenhagen', calendar_days = 14, calendar_item_limit = 8,
  display_schedule = '{"enabled":true,"timezone":"Europe/Copenhagen","pages":[{"id":"fixture","name":"Øjeblik","duration_seconds":120,"layout":{"version":1,"cols":10,"rows":6,"widgets":[{"i":"custom-text","x":0,"y":0,"w":10,"h":6}]}}],"quiet_hours":{"enabled":true,"start":"22:30","end":"07:15"}}',
  show_custom_webhook = true, custom_webhook_ttl_minutes = 90
WHERE user_id = '00000000-0000-4000-8000-000000000001';
INSERT INTO api_keys (id, user_id, provider, api_key) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'ci-fixture', E'fixture-ciphertext,\nopaque-bytes');
INSERT INTO devices (id, user_id, device_id, ble_name, license_key) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'ci-device', 'OD-ci', NULL);
INSERT INTO firmware_versions (id, user_id, version, download_path) VALUES ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'ci-version', 'https://example.invalid/fixture.bin');
INSERT INTO api_usage (id, user_id, endpoint) VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '/ci-fixture');
INSERT INTO custom_webhooks (user_id, token_hash, token_created_at, rows, observed_at, received_at)
VALUES ('00000000-0000-4000-8000-000000000001', repeat('a', 64), '2026-09-28T10:01:02.123456Z', '[{"label":"Køkken","value":"21.5","unit":"°C"}]', '2026-09-28T09:59:59Z', '2026-09-28T10:01:03Z');
INSERT INTO device_delivery (device_id, owner_id, token_hash, rotated_at, revoked_at, last_seen_at, firmware_version, battery_percent, rssi, last_applied_hash)
VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', repeat('b', 64), '2026-09-28T10:01:02.123456Z', NULL, '2026-09-28T10:02:03.654321Z', 'ci-delivery', 72.5, -65, repeat('c', 64));
UPDATE device_delivery SET refresh_request_id = '00000000-0000-4000-8000-000000000009',
  refresh_requested_at = '2026-10-02T10:01:02.123456Z', refresh_applied_at = '2026-10-02T10:02:03.654321Z',
  instant_updates = true;
INSERT INTO device_displays (device_id, owner_id, layout, display_schedule, active_layout_id, display_profile, display_timezone, refresh_interval_minutes, revision, updated_at)
SELECT '00000000-0000-4000-8000-000000000004', user_id, layout, display_schedule, 'fixture', display_profile, 'Europe/Copenhagen', 15, 3, '2026-10-02T10:01:02.123456Z'
FROM user_preferences WHERE user_id = '00000000-0000-4000-8000-000000000001';
INSERT INTO orders (id, user_id, amount_cents, status) VALUES ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 1250, 'ci-fixture');
SQL

run_python() { timeout 120 "${compose[@]}" run --rm -T --no-deps --entrypoint python tools - "$@"; }
migration() { timeout 120 "${compose[@]}" run --rm -T --no-deps tools "$@"; }
expect_failure() {
  expected=$1; shift
  if "$@" >"$stage/expected-failure.log" 2>&1; then die "Operation unexpectedly succeeded: $expected"; fi
  python3 - "$stage/expected-failure.log" "$expected" <<'PY'
from pathlib import Path
import sys
if sys.argv[2] not in Path(sys.argv[1]).read_text():
    raise SystemExit('Expected failure reason was not returned; inspect the private test log.')
PY
}
assert_empty() {
  run_python <<'PY'
import sys
sys.path.insert(0, '/tools')
import migrate, psycopg
with psycopg.connect(service='eink-target') as connection:
    migrate.check_target_identity(connection)
    migrate.check_empty_target(connection)
print('PASS: all ten target tables remain empty.')
PY
}

# Only this fixture harness skips transport TLS on the private Docker network.
# The public CLI always enforces verify-full for real source inspect/export.
run_python <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, '/tools')
import migrate, psycopg
with psycopg.connect(service='eink-ci-source') as connection:
    report = migrate.inspect_source(connection)
    assert not report['schema_drift'], (report['schema_drift'], {
        table: details['constraints'] for table, details in report['tables'].items()
    })
    assert all(report['tables'][table]['row_count'] == 1 for table in migrate.TABLES)
    manifest = migrate.export_bundle(connection, Path('/work/bundle'))
assert all(item['row_count'] == 1 for item in manifest['tables'].values())
print('PASS: real PostgreSQL source inspection and consistent ten-table export.')
PY

# A unique expression/partial index is invisible to pg_constraint. It must
# block source export and target import rather than silently losing its rule.
run_python <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, '/tools')
import migrate, psycopg
for service in ('eink-ci-source', 'eink-target'):
    with psycopg.connect(service=service, autocommit=True) as connection:
        connection.execute('CREATE UNIQUE INDEX ci_unique_lower_email ON public.users (lower(email)) WHERE email IS NOT NULL')
        try:
            if service == 'eink-ci-source':
                report = migrate.inspect_source(connection)
                assert report['tables']['users']['standalone_unique_indexes'] == ['ci_unique_lower_email']
                assert any('Standalone unique index drift in users' in error for error in report['schema_drift'])
                operation = lambda: migrate.export_bundle(connection, Path('/work/unique-index-refused'))
            else:
                operation = lambda: migrate.import_bundle(connection, Path('/work/bundle'))
            try:
                operation()
            except migrate.MigrationError as error:
                assert 'Standalone unique index drift in users' in str(error), str(error)
            else:
                raise AssertionError('Standalone unique index was not refused')
        finally:
            connection.execute('DROP INDEX public.ci_unique_lower_email')
assert (Path('/work/unique-index-refused') / '.incomplete').exists()
print('PASS: standalone unique source/target indexes are refused.')
PY
assert_empty

python3 - "$MIGRATION_WORK_DIR" <<'PY'
from pathlib import Path
import hashlib, json, shutil, sys
work = Path(sys.argv[1])
tampered = work / 'tampered'
shutil.copytree(work / 'bundle', tampered)
with (tampered / 'api_keys.csv').open('ab') as output:
    output.write(b'corrupt-fixture\n')
# Both bundles have valid file/manifest hashes and reach COPY. The FK error
# occurs in the final table. The padded integer is accepted by COPY but becomes
# canonical 1250 on re-export, causing verification to fail after all ten COPYs.
for name, old, new in (
    ('bad-fk', b'00000000-0000-4000-8000-000000000001', b'00000000-0000-4000-8000-000000000099'),
    ('bad-checksum', b'\n1250,', b'\n01250,'),
):
    bundle = work / name
    shutil.copytree(work / 'bundle', bundle)
    original = (bundle / 'orders.csv').read_bytes()
    assert original.count(old) == 1
    data = original.replace(old, new)
    (bundle / 'orders.csv').write_bytes(data)
    manifest = json.loads((bundle / 'manifest.json').read_bytes())
    manifest['tables']['orders'].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
    encoded = (json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=True) + '\n').encode()
    (bundle / 'manifest.json').write_bytes(encoded)
    (bundle / 'manifest.sha256').write_text(hashlib.sha256(encoded).hexdigest() + '\n')
PY
expect_failure 'Data checksum/size mismatch' migration import --service eink-target --bundle /work/tampered
assert_empty
expect_failure '23503' migration import --service eink-target --bundle /work/bad-fk
assert_empty
expect_failure 'Full-row content checksum mismatch for orders' migration import --service eink-target --bundle /work/bad-checksum
assert_empty
migration import --service eink-target --bundle /work/bundle
migration verify --service eink-target --bundle /work/bundle
expect_failure 'Import requires empty target tables' migration import --service eink-target --bundle /work/bundle
migration verify --service eink-target --bundle /work/bundle

"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U eink_admin -d eink <<'SQL'
DO $$
DECLARE client_role text; table_name text; privilege_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eink_authenticator' AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'Unsafe authenticator privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND (rolsuper OR rolcanlogin OR NOT rolbypassrls)) THEN
    RAISE EXCEPTION 'Unsafe service_role privileges';
  END IF;
  IF has_table_privilege('eink_authenticator', 'public.users', 'SELECT') OR has_schema_privilege('eink_authenticator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Authenticator must explicitly switch role';
  END IF;
  IF has_function_privilege('service_role', 'public.update_updated_at_column()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.clear_device_display_on_transfer()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected RPC function grant';
  END IF;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) OR EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = client_role
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
      RAISE EXCEPTION 'Compatibility client roles must exist and remain inert';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.roleid, m.member)
      WHERE r.rolname = client_role
    ) OR has_database_privilege(client_role, 'eink', 'CONNECT,CREATE,TEMPORARY')
      OR has_schema_privilege(client_role, 'public', 'USAGE,CREATE')
      OR has_function_privilege(client_role, 'public.update_updated_at_column()', 'EXECUTE')
      OR has_function_privilege(client_role, 'public.clear_device_display_on_transfer()', 'EXECUTE') THEN
      RAISE EXCEPTION 'Compatibility client roles gained membership/database/schema/function access';
    END IF;
    FOREACH table_name IN ARRAY ARRAY['users','user_preferences','api_keys','devices','firmware_versions','api_usage','custom_webhooks','device_delivery','device_displays','orders'] LOOP
      IF has_table_privilege(client_role, 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Compatibility client role gained table access';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['custom_webhooks', 'device_delivery', 'device_displays'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF NOT has_table_privilege('service_role', 'public.' || table_name, privilege_name) THEN
        RAISE EXCEPTION 'Missing service CRUD grant';
      END IF;
    END LOOP;
    IF has_table_privilege('service_role', 'public.' || table_name, 'TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'Service role has excessive table grants';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'Private service table is missing RLS';
    END IF;
  END LOOP;
END $$;
SQL

timeout 180 "${compose[@]}" up -d --wait --wait-timeout 120 postgrest gateway
export EINK_SMOKE_URL=http://127.0.0.1:3080
EINK_SMOKE_SERVICE_KEY=$(python3 - "$stage/backend.env" <<'PY'
from pathlib import Path
import sys
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        print(line.split('=', 1)[1])
        break
else:
    raise SystemExit('Generated service key missing')
PY
)
export EINK_SMOKE_SERVICE_KEY
timeout 180 node "$script_dir/smoke.mjs" --write-test
unset EINK_SMOKE_SERVICE_KEY
# The smoke fixture's cascade cleanup must leave every original row identical.
migration verify --service eink-target --bundle /work/bundle

run_python <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, '/tools')
import migrate, psycopg
before = migrate.load_bundle(Path('/work/bundle'))
with psycopg.connect(service='eink-ci-source') as connection:
    after = migrate.export_bundle(connection, Path('/work/source-after'))
for table in migrate.TABLES:
    assert before['tables'][table]['sha256'] == after['tables'][table]['sha256'], table
    assert before['tables'][table]['row_count'] == after['tables'][table]['row_count'], table
print('PASS: source unchanged; export/import, refusal, rollback, real SDK and cleanup verified.')
PY

# Confirm the native test actually used the 4 GB profile and did not hide an OOM
# behind a restart. Inspect only resource/state fields, never container secrets.
running_ids=$("${compose[@]}" ps --quiet postgres postgrest gateway)
python3 - "$running_ids" "$script_dir" <<'PY'
import json, subprocess, sys
sys.path.insert(0, sys.argv[2])
from memory_budget import EINK
expected = EINK
ids = sys.argv[1].split()
if len(ids) != len(expected):
    raise SystemExit('Missing a running low-memory service')
template = '{"service":{{json (index .Config.Labels "com.docker.compose.service")}},"memory":{{.HostConfig.Memory}},"oom":{{.State.OOMKilled}},"restarts":{{.RestartCount}}}'
output = subprocess.check_output(['docker', 'inspect', '--format', template, *ids], text=True)
seen = set()
for line in output.splitlines():
    item = json.loads(line)
    service = item['service']
    if service not in expected or service in seen:
        raise SystemExit('Unexpected or repeated low-memory service')
    seen.add(service)
    if item['memory'] != expected[service] or item['oom'] or item['restarts']:
        raise SystemExit('Low-memory profile was not applied or a service restarted/OOMed')
if seen != set(expected):
    raise SystemExit('Incomplete low-memory service inventory')
print('PASS: native 384/128/32 MiB service caps applied with no OOM or restart.')
PY
# Exercise the real Linux systemd/Docker inventory path as well as mocked
# 4 GB boundary cases. CI's RAM is larger and does not certify the actual Pi.
python3 "$script_dir/memory_budget.py"
