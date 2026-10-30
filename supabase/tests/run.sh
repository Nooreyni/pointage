#!/usr/bin/env bash
# Lance les migrations + tests sur un PostgreSQL 16 jetable (local).
# Usage : supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
B=/usr/lib/postgresql/16/bin
W=$(mktemp -d); chmod 777 "$W"
trap 'su postgres -c "$B/pg_ctl -D $W/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT
su postgres -c "$B/initdb -D $W/data -A trust >/dev/null && $B/pg_ctl -D $W/data -o '-p 5498 -k $W' -l $W/log start >/dev/null"
P="psql -h $W -p 5498 -U postgres -X -q -v ON_ERROR_STOP=1"
$P -c "alter database postgres set timezone to 'Europe/Brussels'"
$P -f tests/00_stub_supabase.sql
for f in migrations/*.sql; do $P -f "$f"; done
$P -f seed.sql
$P -f tests/10_securite.sql
