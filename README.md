# CFB Pointage

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
Prérequis : PostgreSQL 16 + paquet `faketime`, Node ≥ 20, Deno 2 (pour le dernier test).

## Environnements
| Env | Base | Données |
|---|---|---|
| dev | Supabase `cfb-pointage-dev` (Francfort, offre gratuite) | Fictives uniquement |
| prod | Organisation Supabase **au nom du CFB** (à créer) | Réelles |

Installation pas à pas : [`docs/deploiement.md`](docs/deploiement.md).
