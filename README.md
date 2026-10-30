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
Lance un PostgreSQL 16 temporaire, applique les migrations et le seed, puis exécute 64 tests
(RLS, workflow N+1 → RH, soldes, clôture, audit, confidentialité).

## Environnements
| Env | Base | Données |
|---|---|---|
| dev | Supabase `cfb-pointage-dev` (Francfort, offre gratuite) | Fictives uniquement |
| prod | Organisation Supabase **au nom du CFB** (à créer) | Réelles |
