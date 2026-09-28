#!/usr/bin/env bash
# A consistent logical backup of ONLY the dedicated e-ink database.
# Usage: bash backup.sh /etc/esp32-eink/.env /srv/esp32-eink/backups
# Keep an encrypted off-Pi copy. This script deliberately has no delete/retention step.
set -Eeuo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  printf 'Usage: bash backup.sh ENV_FILE EXISTING_PRIVATE_BACKUP_DIRECTORY\n' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
env_file=$(realpath -e -- "$1")
backup_dir=$(realpath -e -- "$2")
if [[ ! -f "$env_file" || ! -d "$backup_dir" || "$backup_dir" == / ]]; then
  printf 'A real env file and an existing dedicated backup directory are required.\n' >&2
  exit 2
fi
python3 "$script_dir/storage_guard.py" --env-file "$env_file" \
  --check-running --extra-path "$backup_dir"
if [[ $(stat -c '%a' -- "$backup_dir") != 700 ]]; then
  printf 'Backup directory must have mode 700; configure it explicitly before running.\n' >&2
  exit 2
fi
exec 9> "$backup_dir/.backup.lock"
flock --nonblock 9 || { printf 'Another e-ink backup is already running.\n' >&2; exit 1; }
compose=(docker compose --project-name esp32-eink --env-file "$env_file" --file "$script_dir/compose.yaml")
identity=$("${compose[@]}" exec -T postgres psql -X --username eink_admin --dbname eink \
  --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --command "SELECT current_database() || '|' || current_user || '|' || application || '|' || format_version FROM migration_control.target_identity WHERE singleton")
if [[ "$identity" != 'eink|eink_admin|esp32-eink|1' ]]; then
  printf 'Database identity guard failed; no backup was attempted.\n' >&2
  exit 1
fi
# The random suffix prevents collisions. Failed dumps remain *.incomplete and
# are never advertised as valid backups. No shell tracing or credentials in args.
partial=$(mktemp "$backup_dir/eink-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.dump.incomplete")
"${compose[@]}" exec -T postgres pg_dump --username eink_admin --dbname eink \
  --format custom --compress gzip:6 --no-owner --no-acl --lock-wait-timeout 10s > "$partial"
# Have PostgreSQL parse its own archive before publishing it.
"${compose[@]}" exec -T postgres pg_restore --list < "$partial" > /dev/null
final=${partial%.incomplete}
mv --no-clobber -- "$partial" "$final"
(
  cd -- "$backup_dir"
  sha256sum -- "$(basename -- "$final")" > "$(basename -- "$final").sha256"
)
printf 'Created %s and SHA-256 checksum. Copy both to encrypted off-Pi storage.\n' "$final"
