#!/usr/bin/env bash
# CFB Pointage : démarrage local en une commande (macOS / Linux)
set -e
cd "$(dirname "$0")/app"
command -v node >/dev/null || { echo "Node.js est requis : installe la version LTS depuis https://nodejs.org"; exit 1; }
[ -d node_modules ] || { echo "Première installation, patiente une minute..."; npm ci; }
npm run dev -- --open
