#!/usr/bin/env bash
# Apply the Flow VPS schema to the agency-db Postgres container.
# Run ONCE on an empty DB (migrations use CREATE TABLE, not IF NOT EXISTS).
# Usage (on the VPS):  bash apply.sh <pg_container> [secrets_file]
set -euo pipefail

PG="${1:?pg container name required}"
SECRETS="${2:-/root/flow-secrets.txt}"
SUPA="$(cd "$(dirname "$0")/.." && pwd)"   # .../supabase
MIG="$SUPA/migrations"
VPS="$SUPA/vps"

# A couple of migrations re-CREATE a policy an earlier one already created
# (these were never applied as a clean sequence on Supabase). Make every
# CREATE POLICY idempotent — inject a matching DROP POLICY IF EXISTS before it,
# so "last definition wins". Harmless on files with no policies.
run() {
  echo ">> $(basename "$1")"
  sed -E 's/^([[:space:]]*)(CREATE POLICY)[[:space:]]+("[^"]+")[[:space:]]+ON[[:space:]]+([A-Za-z0-9_.]+)/\1DROP POLICY IF EXISTS \3 ON \4;\n\1\2 \3 ON \4/I' "$1" \
    | docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q
}

run "$VPS/00_bootstrap.sql"
for n in 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016; do
  run "$(ls "$MIG/${n}_"*.sql)"
done
# 017_org_logos_bucket.sql skipped on purpose (Supabase Storage only)
run "$VPS/018b_update_profile.sql"
run "$(ls "$MIG/019_"*.sql)"
run "$(ls "$MIG/020_"*.sql)"   # RPCs que faltavam no repo (reconstruídas)
run "$VPS/99_grants.sql"

# Set the authenticator password from the secrets file (value never printed).
PW=$(grep '^AUTHENTICATOR_PW=' "$SECRETS" | cut -d= -f2-)
docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "alter role authenticator with password '$PW';" >/dev/null
echo ">> authenticator password set from $SECRETS"
echo "DONE"
