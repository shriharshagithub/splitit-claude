#!/usr/bin/env bash
# Development helper: deploy one edge function (with its _shared files) through the Management API.
# Usage: scripts/deploy-function.sh <name> <verify_jwt true|false>
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-ohawfftzgjuqwbilovmy}"
name="$1"; verify="${2:-true}"
cd supabase/functions
args=()
for f in "$name/index.ts" $(find _shared -name '*.ts'); do args+=(-F "file=@$f;filename=$f;type=application/typescript"); done
meta=$(jq -nc --arg n "$name" --argjson v "$verify" '{name:$n, entrypoint_path:($n+"/index.ts"), verify_jwt:$v}')
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=$name" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy}" -F "metadata=$meta;type=application/json" "${args[@]}"
echo
