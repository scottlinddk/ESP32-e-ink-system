#!/usr/bin/env bash
# Regenerate src/types/database.ts from the live Supabase schema.
# Follows https://supabase.com/docs/guides/api/rest/generating-types
#
# Auth (one of):
#   - export SUPABASE_ACCESS_TOKEN=<personal access token>   (https://supabase.com/dashboard/account/tokens)
#   - npx supabase login                                      (interactive, one-time)
#
# Override the target project with PROJECT_REF (or SUPABASE_PROJECT_ID).
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="${PROJECT_REF:-${SUPABASE_PROJECT_ID:-wormvwlzppaifrngughw}}"
OUT="src/types/database.ts"

# Write to a temp file first so a failed run doesn't truncate the existing types
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > "$TMP"
mv "$TMP" "$OUT"
trap - EXIT
echo "Wrote $OUT (project: $PROJECT_REF)"
