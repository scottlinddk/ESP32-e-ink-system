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
storage = json.load(sys.stdin).get("x-eink-storage", {})
if storage.get("mount") != "/" or storage.get("uuid") != "ci-disposable-fixture":
    raise SystemExit("Compose did not preserve the expected storage identity extension")
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
"${compose[@]}" exec -T postgres bash -euc 'export LC_ALL=C; for migration in /migrations/*.sql; do psql -X -v ON_ERROR_STOP=1 -U eink_admin -d eink_source -f "$migration"; done'
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U eink_admin -d eink_source <<'SQL'
INSERT INTO users (id, email, display_name) VALUES ('00000000-0000-4000-8000-000000000001', 'fixture@example.invalid', E'Unicode æøå, "quotes"\nand newline');
INSERT INTO user_preferences (id, user_id, layout) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '{"nested":[null,false,1.25],"label":"æøå"}');
INSERT INTO api_keys (id, user_id, provider, api_key) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'ci-fixture', E'fixture-ciphertext,\nopaque-bytes');
INSERT INTO devices (id, user_id, device_id, ble_name, license_key) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'ci-device', 'OD-ci', NULL);
INSERT INTO firmware_versions (id, user_id, version, download_path) VALUES ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'ci-version', 'https://example.invalid/fixture.bin');
INSERT INTO api_usage (id, user_id, endpoint) VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '/ci-fixture');
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
print('PASS: all seven target tables remain empty.')
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
    assert not report['schema_drift'], report['schema_drift']
    assert all(report['tables'][table]['row_count'] == 1 for table in migrate.TABLES)
    manifest = migrate.export_bundle(connection, Path('/work/bundle'))
assert all(item['row_count'] == 1 for item in manifest['tables'].values())
print('PASS: real PostgreSQL source inspection and consistent seven-table export.')
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
# canonical 1250 on re-export, causing verification to fail after all seven COPYs.
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
  IF has_function_privilege('service_role', 'public.update_updated_at_column()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected RPC function grant';
  END IF;
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
