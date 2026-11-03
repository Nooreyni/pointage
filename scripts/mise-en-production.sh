#!/usr/bin/env bash
# Mise en production (ou mise à jour) de CFB Pointage sur un projet Supabase + Cloudflare Pages.
# À lancer depuis la racine du dépôt, sur un poste qui joint Supabase (pas besoin des droits admin du poste).
#
#   export DB_URL='postgresql://postgres.<ref>:<mot de passe>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
#   export PROJET=<ref du projet>              # ex. abcdefghijklmnopqrst (Supabase › Project Settings › General)
#   export APPLI_URL=https://pointage.<domaine>   # adresse publique de l'appli
#   export CONTACT=mailto:it@<domaine>            # contact technique (notifications push)
#   export CLE_PUBLIQUE=sb_publishable_…         # Supabase › Project Settings › API Keys (clé « publishable »)
#   scripts/mise-en-production.sh [--sans-front]
#
# Étapes : 1. garde-fous  2. migrations (une seule fois chacune, dans l'ordre)  3. fonctions serveur
#          4. clés d'envoi des notifications (1re installation)  5. contrôles  6. appli (build + Cloudflare Pages).
# Aucune donnée fictive n'est chargée. Rien n'est supprimé. Relançable sans risque (ce qui est déjà fait est sauté).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DB_URL:?DB_URL manquant}" "${PROJET:?PROJET manquant}" "${APPLI_URL:?APPLI_URL manquant}" "${CONTACT:?CONTACT manquant}"
PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1)
etape() { printf '\n\033[1m%s\033[0m\n' "$*"; }

etape "1. Garde-fous"
[ "$PROJET" = "xsgxsilezyfjotpsxhlw" ] && { echo "Ce projet est celui de DÉVELOPPEMENT : arrêt."; exit 1; }
command -v psql >/dev/null || { echo "psql requis (paquet postgresql-client)"; exit 1; }
"${PSQL[@]}" -c "select 1" >/dev/null && echo "Connexion à la base : OK"
if "${PSQL[@]}" -tAc "select to_regclass('pointage.personnes') is not null" | grep -q t; then
  n=$("${PSQL[@]}" -tAc "select count(*) from pointage.personnes where email like '%@cfb.test'")
  [ "$n" != "0" ] && { echo "Des comptes fictifs (@cfb.test) sont présents : ce n'est pas une base de production. Arrêt."; exit 1; }
fi

etape "2. Migrations"
"${PSQL[@]}" -c "create table if not exists public._migrations_cfb (nom text primary key, appliquee_le timestamptz not null default now());
                 revoke all on public._migrations_cfb from anon, authenticated;"
for f in supabase/migrations/*.sql; do
  nom=$(basename "$f")
  if "${PSQL[@]}" -tAc "select 1 from public._migrations_cfb where nom = '$nom'" | grep -q 1; then continue; fi
  echo "  → $nom"
  "${PSQL[@]}" -1 -f "$f" -c "insert into public._migrations_cfb (nom) values ('$nom')"
done
echo "Migrations à jour"

etape "3. Fonctions serveur (Supabase CLI via npx)"
npx --yes supabase@2 functions deploy envoyer-notifications --no-verify-jwt --project-ref "$PROJET"
npx --yes supabase@2 functions deploy gerer-comptes --project-ref "$PROJET"
npx --yes supabase@2 functions deploy agenda --no-verify-jwt --project-ref "$PROJET"

etape "4. Clés d'envoi des notifications"
if "${PSQL[@]}" -tAc "select coalesce((select valeur from pointage.configuration where cle = 'vapid_public'), '')" | grep -q .; then
  echo "Déjà configurées (non régénérées : les téléphones abonnés restent valides)"
else
  # Les clés vont directement dans la base : elles ne sont écrites nulle part sur le disque
  node scripts/generer-config-envoi.mjs "https://$PROJET.supabase.co" "$APPLI_URL" "$CONTACT" | "${PSQL[@]}" -f -
  echo "Clés générées et enregistrées"
fi

etape "5. Contrôles"
"${PSQL[@]}" -f scripts/verifier-installation.sql

if [ "${1:-}" != "--sans-front" ]; then
  etape "6. Appli : build + Cloudflare Pages"
  : "${CLE_PUBLIQUE:?CLE_PUBLIQUE manquant (clé publishable)}"
  ( cd app && npm ci && VITE_SUPABASE_URL="https://$PROJET.supabase.co" VITE_SUPABASE_KEY="$CLE_PUBLIQUE" VITE_CONNEXION_DEV=0 VITE_MODE_DEMO=0 npm run build
    npx --yes wrangler@4 pages deploy dist --project-name cfb-pointage --branch main )
fi

etape "Terminé. À faire dans le tableau de bord Supabase (une fois) : voir docs/passation.md § Mise en production."
