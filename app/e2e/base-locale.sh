#!/usr/bin/env bash
# Base PostgreSQL 16 locale pour tester l'application RÉELLE (pas la démo) : migrations + données fictives + comptes.
# Usage : e2e/base-locale.sh start | stop      (port 5499, dossier /tmp/cfb-base-locale)
set -euo pipefail
cd "$(dirname "$0")/.."
B=/usr/lib/postgresql/16/bin; D="${BASE_LOCALE_DIR:-/tmp/cfb-base-locale}"; PORT=5499
case "$D" in /tmp/?*) ;; *) echo "BASE_LOCALE_DIR doit être sous /tmp" >&2; exit 1 ;; esac
SU() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }
# Le dossier de données appartient à postgres : on le supprime avec ce compte (sinon refus sur un poste non root / la CI)
effacer() { SU "rm -rf -- '${D:?}'" 2>/dev/null || rm -rf -- "${D:?}" 2>/dev/null || true; }
case "${1:-start}" in
  stop) SU "$B/pg_ctl -D $D/data stop -m fast" >/dev/null 2>&1 || true; effacer; echo "Base locale arrêtée"; exit 0 ;;
esac
effacer; mkdir -p "$D"; chmod 777 "$D"
SU "$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=localhost' -l $D/log start >/dev/null"
P="psql -h localhost -p $PORT -U postgres -X -q -v ON_ERROR_STOP=1"
for i in $(seq 1 20); do $P -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done
$P -c "alter database postgres set timezone to 'Europe/Brussels'"
$P -f ../supabase/tests/00_stub_supabase.sql
for f in ../supabase/migrations/*.sql; do $P -f "$f"; done
$P -f ../supabase/seed.sql
# Comptes de connexion (mot de passe unique des tests, voir mini-supabase.cjs) ; l'anti double appui gênerait les parcours rapides
$P -c "insert into auth.users (email, email_confirmed_at, raw_app_meta_data) select email, now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}' from pointage.personnes;
       update pointage.personnes p set auth_user_id = u.id from auth.users u where u.email = p.email;   -- comme attacher_compte (création par la RH)
       update pointage.parametres set valeur = 0 where cle = 'anti_rebond_s';"
echo "Base locale prête : postgresql://postgres@localhost:$PORT/postgres"
