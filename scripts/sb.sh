#!/usr/bin/env bash
# Development helper: run SQL against the Supabase project through the Management API.
# Usage: scripts/sb.sh query "<sql>" | scripts/sb.sh migrate <file.sql>
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-ohawfftzgjuqwbilovmy}"
API="https://api.supabase.com/v1/projects/$REF"
AUTH=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy}" -H "Content-Type: application/json")
case "$1" in
  query) jq -n --arg q "$2" '{query:$q}' | curl -sS "${AUTH[@]}" -X POST "$API/database/query" --data @- ;;
  migrate) name=$(basename "$2" .sql); jq -n --rawfile q "$2" --arg n "${name#*_}" '{query:$q, name:$n}' | curl -sS "${AUTH[@]}" -X POST "$API/database/migrations" --data @- ;;
esac
