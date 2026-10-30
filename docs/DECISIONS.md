# Décisions d'architecture

## D1 — API : schéma privé + fonctions contrôlées (30/10/2026)
- Tables dans `pointage` (non exposé par l'API REST Supabase).
- Lecture : vues `security_invoker` dans `public` → la RLS s'applique.
- Écriture : **uniquement** via fonctions RPC (`pointer`, `soumettre_demande`, `decider_n1`, `traiter_rh`…)
  qui vérifient identité, rôle et workflow. Aucun INSERT/UPDATE direct possible.
- Raison : la v0.1 (droits d'écriture + RLS) permettait l'auto-validation et la création de
  demandes déjà accordées. Ce modèle ferme la classe de failles entière.
- Avertissement Supabase « SECURITY DEFINER exécutable » : **accepté**, c'est la surface d'API voulue.

## D2 — Identité
- Supabase Auth, fournisseur Azure (Entra ID) restreint au tenant CFB.
- Liaison compte ↔ personne au 1er login par e-mail (trigger `lier_compte`).
  Adresse inconnue = compte sans aucun accès.

## D3 — Hébergement (coût / qualité / sécurité)
| Brique | Choix | Coût prod / mois | Pourquoi |
|---|---|---|---|
| Front PWA | Azure Static Web Apps (Europe de l'Ouest) — Free en dev, Standard en prod | 0 € dev ; Standard ≈ 9 $ (à confirmer au calculateur Azure) | Même tenant que M365, pas de nouveau fournisseur, SLA en Standard |
| Base + API + Auth | Supabase Pro, org CFB, Francfort | 25 $ (inclut 10 $ de compute = 1 instance Micro) | RLS testée, auth Entra native, sauvegardes quotidiennes, pas de mise en pause |
| Tâches (Graph, rappels Teams) | Supabase Edge Functions + pg_cron | Inclus | Pas d'infra en plus |
| **Total** | | **≈ 35 $/mois** | |

Écartés :
- Azure Database for PostgreSQL seul : il faudrait coder API + auth → plus de code, plus de surface d'attaque.
- Vercel Hobby : usage non commercial uniquement ; Pro facturé par membre.
- Offre gratuite Supabase en prod : pause après 1 semaine d'inactivité, pas de sauvegarde garantie.

Sécurité Graph : permissions applicatives limitées par Exchange RBAC for Applications
(accès aux seules boîtes du groupe « CFB Pointage »), secrets dans les secrets Edge Functions.
