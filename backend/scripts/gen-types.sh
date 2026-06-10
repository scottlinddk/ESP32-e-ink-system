#!/usr/bin/env bash
# Regenerate src/types/database.ts from the live Supabase schema.
#
# Requires the Supabase CLI to be authenticated: either set SUPABASE_ACCESS_TOKEN
# or run `npx supabase login` once. Override the target project with SUPABASE_PROJECT_ID.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_ID="${SUPABASE_PROJECT_ID:-wormvwlzppaifrngughw}"
OUT="src/types/database.ts"

npx --yes supabase gen types typescript --project-id "$PROJECT_ID" --schema public > "$OUT"
echo "Wrote $OUT (project: $PROJECT_ID)"
