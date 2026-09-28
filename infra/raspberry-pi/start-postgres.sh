#!/usr/bin/env bash
# Validate the effective bind mount before starting ONLY the selected e-ink DB.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ $# -lt 3 || "$2" != --ssd-uuid || -z "$3" ]]; then
  printf 'Usage: bash start-postgres.sh ENV_FILE --ssd-uuid VERIFIED_UUID [--recovery]\n' >&2
  exit 2
fi
env_file=$1
shift
exec python3 "$script_dir/storage_guard.py" --env-file "$env_file" --start "$@"
