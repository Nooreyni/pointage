#!/usr/bin/env bash
# Lance tout le parcours sur l'application réelle : base locale → mini Supabase → appli → e2e/reel.cjs → arrêt.
set -euo pipefail
cd "$(dirname "$0")/.."
bash e2e/base-locale.sh start
node e2e/mini-supabase.cjs > /tmp/cfb-e2e-api.log 2>&1 & API=$!
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_KEY=cle-de-test-locale VITE_CONNEXION_DEV=1 VITE_MODE_DEMO=0 \
  npx vite --port 5174 --strictPort > /tmp/cfb-e2e-vite.log 2>&1 & APPLI=$!
trap 'kill $API $APPLI 2>/dev/null || true; bash e2e/base-locale.sh stop >/dev/null' EXIT
for i in $(seq 1 40); do curl -sf http://localhost:5174/ >/dev/null && curl -s http://localhost:54321/ >/dev/null && break; sleep 1; done
node e2e/reel.cjs
