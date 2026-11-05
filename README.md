# CFB Pointage

**Appli en ligne (projet dev, données fictives)** : https://pointage.nooreyni35.workers.dev

Application de pointage et de congés (PWA mobile + PC) du Centre Familial de Bruxelles, remplaçante de Dinclock.
Conçue pour être **réinstallée ailleurs sans recoder** : toutes les règles sont des paramètres (Admin → Paramètres).

## Fonctionnalités
| Domaine | Contenu |
|---|---|
| Pointage | 1 tap, type auto (réseau du bureau / extérieur), hors ligne (file par personne), pointage différé signalé, correction d'oubli auto-validée |
| Heures | Fiche de temps mensuelle (13 mois), boni, pause auto, max jour / semaine, export CSV |
| Congés | Demande avec simulation (solde, collègues absents), validation décentralisée par le N+1, calendrier d'équipe, justificatifs |
| Équipe | Présence du jour par service, rappels des non pointés, fiche de temps d'un clic |
| RH | Anomalies par service + rappels, constat, absences, heures au-delà du max, clôture mensuelle, congés annuels au prorata |
| Rapports | Tableau de bord direction (anonymisé pour les petits services), rapport CPAS des ISP |
| Admin | Personnes, services et chefs, régimes, accès inter-services, compteurs et reports, paramètres, réseau, fériés |
| Notifications | Push sur téléphone / PC, e-mail de secours Microsoft 365, rappels automatiques |

## Démarrer en local (1 double-clic)
Prérequis : [Node.js LTS](https://nodejs.org).
- **Windows** : double-cliquer sur `demarrer.bat`
- **macOS / Linux** : `./demarrer.sh`

Le premier lancement installe l'appli (≈ 1 min), puis le navigateur s'ouvre tout seul.
Connexion au projet de **dev** (données fictives) ou « Essayer en mode démo » (sans serveur).

## Structure
| Dossier | Contenu |
|---|---|
| `supabase/migrations/` | Schéma PostgreSQL versionné (source de vérité : règles, droits, calculs) |
| `supabase/functions/envoyer-notifications/` | Service d'envoi des notifications (Deno, sans dépendance) |
| `supabase/seed.sql` | Données **fictives** de développement |
| `supabase/tests/` | Tests SQL (PostgreSQL jetable, horloge figée) |
| `app/` | Appli React + TypeScript (Vite), installable (PWA) |
| `scripts/` | Outils d'installation |
| `docs/` | Décisions, audit, **guide d'installation** (`docs/deploiement.md`) |

## Tester
```bash
supabase/tests/run.sh
```
```bash
cd app && npm ci && npm test && npm run build
```
```bash
node supabase/functions/envoyer-notifications/integration.test.mjs supabase/functions/envoyer-notifications/index.ts email
```
Parcours dans un vrai navigateur (5 rôles, mobile et PC, accessibilité, superposition, aide, validation, fiches) :
```
cd app && npx playwright install chromium   # une seule fois
npm run dev                                  # dans un autre terminal
npm run e2e
```
Même chose sur l'**appli réelle** (base PostgreSQL 16 locale + mini serveur compatible Supabase, 7 comptes) :
```
cd app && npm run e2e:reel
```
Prérequis : PostgreSQL 16 + paquet `faketime`, Node ≥ 20, Deno 2 (pour le dernier test). Tout tourne aussi automatiquement sur GitHub à chaque envoi (`.github/workflows/tests.yml`).

## Environnements
| Env | Base | Données |
|---|---|---|
| dev | Supabase `cfb-pointage-dev` (Francfort, offre gratuite) | Fictives uniquement |
| prod | Organisation Supabase **au nom du CFB** (à créer) | Réelles |

Installation pas à pas : [`docs/deploiement.md`](docs/deploiement.md).

## Documents
| Document | Pour |
|---|---|
| `docs/passation.md` | Reprendre l'outil : architecture, comptes, mise en production, mises à jour, tâches courantes |
| `docs/pilote.md` | Préparer et juger le pilote (double fonctionnement avec Dinclock, critères go / no-go) |
| `docs/deploiement.md` | Installation détaillée (notifications, Microsoft, appli) |
| `scripts/mise-en-production.sh` | Migrations, fonctions, clés, contrôles, appli — relançable |
| `scripts/verifier-installation.sql` | Contrôle d'une installation (sécurité, tâches, clés, valeurs à confirmer) |
