# CFB Pointage

Application de pointage (PWA mobile + PC) du Centre Familial de Bruxelles, remplaçante de Dinclock.

## Structure
| Dossier | Contenu |
|---|---|
| `supabase/migrations/` | Schéma PostgreSQL versionné (source de vérité) |
| `supabase/seed.sql` | Données **fictives** de développement |
| `supabase/tests/` | Tests sécurité + workflow (PostgreSQL jetable) |
| `docs/` | Décisions d'architecture et d'hébergement |

## Tester le schéma
```bash
supabase/tests/run.sh
```
Lance un PostgreSQL 16 temporaire, applique les migrations et le seed, puis exécute 101 tests
(accès, hiérarchie, circuit décentralisé, ISP, accès inter-services, calcul des journées,
boni, heures à valider, rappels, congés au prorata, clôture, audit).

> Plusieurs tests utilisent des dates d'octobre-novembre 2026 : à rafraîchir si on les relance plus tard.

## Environnements
| Env | Base | Données |
|---|---|---|
| dev | Supabase `cfb-pointage-dev` (Francfort, offre gratuite) | Fictives uniquement |
| prod | Organisation Supabase **au nom du CFB** (à créer) | Réelles |
