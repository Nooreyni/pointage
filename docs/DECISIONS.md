# Décisions d'architecture

## D1 — API : schéma privé + fonctions contrôlées (30/10/2026)
- Tables dans `pointage` (non exposé par l'API REST Supabase).
- Lecture : vues `security_invoker` dans `public` → la RLS s'applique.
- Écriture : **uniquement** via fonctions RPC (`pointer`, `corriger_pointage`, `soumettre_demande`, `decider`…)
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
| Front PWA | **Cloudflare Pages** (le CFB n'a pas d'abonnement Azure) | 0 € | Rien à maintenir, compte au nom du CFB |
| Base + API + Auth | Supabase Pro, org CFB, Francfort | 25 $ (inclut 10 $ de compute = 1 instance Micro) | RLS testée, auth Entra native, sauvegardes quotidiennes, pas de mise en pause |
| Tâches (Graph, rappels Teams) | Supabase Edge Functions + pg_cron | Inclus | Pas d'infra en plus |
| **Total** | | **≈ 35 $/mois** | |

Écartés :
- Azure Database for PostgreSQL seul : il faudrait coder API + auth → plus de code, plus de surface d'attaque.
- Vercel Hobby : usage non commercial uniquement ; Pro facturé par membre.
- Offre gratuite Supabase en prod : pause après 1 semaine d'inactivité, pas de sauvegarde garantie.

Sécurité Graph : permissions applicatives limitées par Exchange RBAC for Applications
(accès aux seules boîtes du groupe « CFB Pointage »), secrets dans les secrets Edge Functions.

## D4 — Modèle v0.3 (31/10/2026)
- **Régimes hebdomadaires** (minutes par jour, lundi → dimanche) + historique par personne. Remplace les ~45 journées types Dinclock.
- **Circuit décentralisé** : la décision du N+1 est définitive, la RH « constate ».
  N+1 = chef du service ; service sans chef, chef qui demande pour lui ou chef absent → service parent (direction).
- **Direction** : peut décider pour tous ; ne reçoit par défaut que ses N-1 (+ services suivis).
- **ISP** : chef de service OU responsable ISP / admin RH.
- **Accès inter-services** accordés par la direction (lecture, ou lecture + validation).
- **Journée calculée** à la volée : paires entrée→sortie, pause auto si non pointée, boni plafonné au max journalier,
  dépassement = « heures à valider » (politique : pas d'heures sup).
- **Boni** : période de référence (trimestre), report posé automatiquement à la clôture ; hors limites = alerte RH, jamais de perte automatique.
- **Règles chiffrées** dans `parametres`, marquées `provisoire` tant qu'elles ne viennent pas du règlement de travail.
- **Rappels** : `generer_rappels()` toutes les 15 min (pg_cron) → table `notifications` ; envoi push / e-mail par Edge Function (à faire).
