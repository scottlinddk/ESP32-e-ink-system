#!/usr/bin/env bash
# Restore a backup into an INITIALIZED, EMPTY, ISOLATED recovery database only.
# Start only recovery postgres beforehand; keep production and Investor running.
# Usage: bash restore.sh /etc/esp32-eink/recovery.env BACKUP.dump --confirm-isolated-recovery
set -Eeuo pipefail
umask 077

if [[ $# -ne 3 || "$3" != --confirm-isolated-recovery ]]; then
  printf 'Usage: bash restore.sh RECOVERY_ENV_FILE BACKUP.dump --confirm-isolated-recovery\n' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
env_file=$(realpath -e -- "$1")
archive=$(realpath -e -- "$2")
if [[ ! -f "$env_file" || ! -f "$archive" || ! -f "$archive.sha256" ]]; then
  printf 'Recovery env, archive and adjacent .sha256 files are required.\n' >&2
  exit 2
fi
# Verify only this archive, never arbitrary filenames embedded in a checksum file.
python3 - "$archive" <<'PY'
import hashlib, pathlib, re, sys
p = pathlib.Path(sys.argv[1])
checksum = pathlib.Path(str(p) + '.sha256').read_text('ascii').strip()
match = re.fullmatch(r'([a-f0-9]{64})  (.+)', checksum)
if not match or match[2] != p.name:
    raise SystemExit('Checksum filename/format mismatch; restore refused.')
with p.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
if digest != match[1]:
    raise SystemExit('Archive checksum mismatch; restore refused.')
PY

compose=(docker compose --project-name esp32-eink-recovery --env-file "$env_file" --file "$script_dir/compose.yaml")
# The helper keeps rendered credentials private and checks mount UUID, aliases,
# project isolation and the actual running container before any restore writes.
resolved_data=$(python3 "$script_dir/storage_guard.py" --env-file "$env_file" \
  --recovery --check-running --extra-path "$archive" --print-data)
# Lock is scoped to this isolated recovery directory; no Investor/production locks.
recovery_parent=$(dirname -- "$resolved_data")
exec 9> "$recovery_parent/.restore.lock"
flock --nonblock 9 || { printf 'Another restore of this recovery instance is running.\n' >&2; exit 1; }
# Keep large archive/SQL staging on the verified recovery SSD, never OS /tmp.
work=$(mktemp -d "$recovery_parent/.eink-recovery.XXXXXX")
container_work=''
cleanup() {
  # Both paths originate from mktemp; constrain deletion to their verified parent.
  if [[ "$container_work" == /var/lib/postgresql/data/.eink-recovery.* && "${container_work%/*}" == /var/lib/postgresql/data ]]; then
    "${compose[@]}" exec -T postgres rm -rf -- "$container_work" >/dev/null 2>&1 || true
  fi
  if [[ "$work" == "$recovery_parent"/.eink-recovery.* && "${work%/*}" == "$recovery_parent" && ! -L "$work" && "$(realpath -e -- "$work")" == "$work" ]]; then
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT
"${compose[@]}" exec -T postgres pg_restore --list < "$archive" > "$work/archive.list"
python3 - "$work/archive.list" "$work/restore.list" <<'PY'
import pathlib, re, sys
tables = ('users', 'user_preferences', 'api_keys', 'devices', 'firmware_versions', 'api_usage', 'orders')
entries = {}
for line in pathlib.Path(sys.argv[1]).read_text('utf-8').splitlines():
    match = re.fullmatch(r'\d+; \d+ \d+ TABLE DATA (\w+) (\w+) \S+', line)
    if re.match(r'\d+;.*\bTABLE DATA\b', line) and not match:
        raise SystemExit('Unrecognized/quoted table data entry; explicit archive review required.')
    if match and (match[1], match[2]) == ('migration_control', 'target_identity'):
        continue  # Keep the marker created by recovery initialization.
    if match:
        if match[1] != 'public' or match[2] not in tables:
            raise SystemExit('Unexpected table data in archive; explicit schema review required.')
        if match[2] in entries:
            raise SystemExit('Duplicate application data entry in archive.')
        entries[match[2]] = line
if set(entries) != set(tables):
    raise SystemExit('Archive must contain all seven application tables exactly once.')
# Full pg_dump archives can put child data first; enforce parent-first order.
pathlib.Path(sys.argv[2]).write_text('\n'.join(entries[t] for t in tables) + '\n', encoding='utf-8')
PY
container_work=$("${compose[@]}" exec -T postgres mktemp -d /var/lib/postgresql/data/.eink-recovery.XXXXXX)
if [[ "$container_work" != /var/lib/postgresql/data/.eink-recovery.* || "${container_work%/*}" != /var/lib/postgresql/data ]]; then
  printf 'Could not allocate private recovery staging.\n' >&2
  exit 1
fi
"${compose[@]}" cp "$work/restore.list" "postgres:$container_work/restore.list" >/dev/null
# Reordered TOCs require a seekable archive: stdin cannot revisit data blocks.
"${compose[@]}" cp "$archive" "postgres:$container_work/backup.dump" >/dev/null
cat > "$work/transaction.sql" <<'SQL'
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30min';
SET LOCAL row_security = off;
DO $$
BEGIN
  IF current_database() <> 'eink' OR current_user <> 'eink_admin' THEN
    RAISE EXCEPTION 'Wrong recovery database/role';
  END IF;
  IF (SELECT count(*) FROM migration_control.target_identity) <> 1 OR NOT EXISTS (
    SELECT 1 FROM migration_control.target_identity
    WHERE singleton AND application = 'esp32-eink' AND format_version = 1
  ) THEN
    RAISE EXCEPTION 'Recovery identity marker mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN (
    'users', 'user_preferences', 'api_keys', 'devices', 'firmware_versions', 'api_usage', 'orders'
  )) THEN
    RAISE EXCEPTION 'Unexpected recovery tables';
  END IF;
END $$;
LOCK TABLE public.users, public.user_preferences, public.api_keys, public.devices,
  public.firmware_versions, public.api_usage, public.orders IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE table_name text; has_rows boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','user_preferences','api_keys','devices','firmware_versions','api_usage','orders'] LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)', table_name) INTO has_rows;
    IF has_rows THEN RAISE EXCEPTION 'Recovery target is not empty'; END IF;
  END LOOP;
END $$;
SQL
# Fully generate/validate data SQL BEFORE opening the restore transaction.
# Append to the guard once, avoiding a second full-sized SQL copy on the SSD.
# Piping pg_restore straight to psql could commit a partial stream on dump failure.
"${compose[@]}" exec -T postgres pg_restore --data-only --no-owner --no-acl \
  --use-list "$container_work/restore.list" "$container_work/backup.dump" >> "$work/transaction.sql"
# SQL errors may include a private failing row: keep stderr in the private staging
# directory instead of printing it. ON_ERROR_STOP + single transaction roll back.
if ! "${compose[@]}" exec -T postgres psql -X --username eink_admin --dbname eink \
  --single-transaction --set ON_ERROR_STOP=1 --file - < "$work/transaction.sql" > "$work/restore.log" 2>&1; then
  printf 'Recovery restore failed and rolled back. Check schema/version and empty-target guard; private row details suppressed.\n' >&2
  exit 1
fi
printf 'Restored the seven application tables atomically into esp32-eink-recovery. Production was not changed.\n'
printf 'Validate row counts, relationships and API behavior on the isolated recovery stack before using it.\n'
