#!/usr/bin/env bash
# Lance les migrations + tests sur un PostgreSQL 16 jetable (local).
# Usage : supabase/tests/run.sh            (horloge figée au 31/10/2026 18:00, heure belge)
#         DATE_TESTS=reelle supabase/tests/run.sh   (horloge réelle, pour contrôle ponctuel)
#
# Les scénarios utilisent des dates précises (fériés, temps partiels, congés de novembre 2026).
# L'horloge du serveur de test est donc figée avec libfaketime (paquet « faketime ») : les tests
# donnent le même résultat quel que soit le jour où on les lance.
set -euo pipefail
cd "$(dirname "$0")/.."
B=/usr/lib/postgresql/16/bin
LIB=$(ls /usr/lib/*/faketime/libfaketime.so.1 2>/dev/null | head -1 || true)
HORLOGE=""
if [ "${DATE_TESTS:-figee}" != "reelle" ]; then
  if [ -z "$LIB" ]; then
    echo "Paquet « faketime » requis (apt-get install faketime) ou DATE_TESTS=reelle" >&2; exit 2
  fi
  # 31/10/2026 18:00 à Bruxelles = 17:00 UTC ; l'horloge avance normalement à partir de là
  HORLOGE="LD_PRELOAD=$LIB FAKETIME='@2026-10-31 17:00:00' TZ=UTC DONT_FAKE_MONOTONIC=1"
fi
W=$(mktemp -d); chmod 777 "$W"
trap 'su postgres -c "$B/pg_ctl -D $W/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$W"' EXIT
su postgres -c "$B/initdb -D $W/data -A trust >/dev/null && env $HORLOGE $B/pg_ctl -D $W/data -o '-p 5498 -k $W' -l $W/log start >/dev/null"
P="psql -h $W -p 5498 -U postgres -X -q -v ON_ERROR_STOP=1"
$P -c "alter database postgres set timezone to 'Europe/Brussels'"
[ -n "$HORLOGE" ] && $P -tAc "select 'Horloge des tests : ' || to_char(now(), 'DD/MM/YYYY HH24:MI TZ')"
$P -f tests/00_stub_supabase.sql
for f in migrations/*.sql; do $P -f "$f"; done
$P -f seed.sql
for t in tests/1*.sql; do $P -f "$t"; done
[ -n "${DBG:-}" ] && $P -f "$DBG"
exit 0
