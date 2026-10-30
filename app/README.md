# CFB Pointage — application (PWA)

Vite + React + TypeScript. Installable sur mobile et PC, fonctionne hors ligne pour le pointage.

## Lancer en local
```bash
cd app
npm install
cp .env.example .env.local   # puis renseigner VITE_SUPABASE_KEY
npm run dev
```
Ouvrir http://localhost:5173 :
- **Mode démo** : http://localhost:5173/?demo=1 (données en mémoire, rien n'est envoyé)
- **Comptes fictifs** (projet dev uniquement) : choisir un compte `@cfb.test` + mot de passe dev

## Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification des types + build de production (`dist/`) |
| `npm test` | Tests unitaires (heures de Bruxelles, calcul de journée) |

## Structure
| Fichier | Rôle |
|---|---|
| `src/lib/supabase.ts` | Accès à l'API (vues + fonctions RPC du schéma) |
| `src/lib/file.ts` | File des pointages hors ligne (rejeu sans doublon via `client_id`) |
| `src/lib/demo.ts` | Mode démo, mêmes règles de calcul que le serveur |
| `src/screens/Pointer.tsx` | Écran de pointage (1 tap, progression, anomalies, correction) |
| `public/sw.js` | Service worker : appli disponible hors ligne, notifications push |

## Hébergement
Fichiers statiques (`dist/`) → Cloudflare Pages (compte au nom du CFB). Aucune donnée n'est stockée côté hébergeur.
