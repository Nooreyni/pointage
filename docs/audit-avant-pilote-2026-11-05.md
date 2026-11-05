# Audit global avant pilote — 05/11/2026

**Verdict : l'application est prête techniquement pour un pilote.** Ce qui reste à faire relève de la mise en place
(comptes au nom du CFB, données réelles, configuration e-mail et réseau, décisions RH et juridiques), pas du code.

## 1. État par axe

| Axe | État | Constat |
|---|---|---|
| Fonctionnel | ✅ | Pointage, congés, validation, rappels, clôture, rapports, fiches, accueil, signalements : couverts par les tests |
| Tests | ✅ | SQL 328/328 · unitaires 23/23 · démo 17/17 · appli réelle 24/24 · PWA 5/5 · CI GitHub 6/6 |
| Sécurité | ✅ (2 réglages à faire) | Aucun secret dans le dépôt ; 0 vulnérabilité npm ; RLS partout ; 67 fonctions exposées, chacune revérifie le rôle (voulu, testé) |
| Performance | ✅ | Test de charge local 124 personnes / 10 000 pointages : pointer 4 ms, Mon mois 4 ms, Suivi RH 0,34 s, tableau de bord 0,83 s. Appli : 154 Ko compressés, écrans hors ligne |
| Exploitation | ⚠️ | Tâches planifiées OK (0 échec / 24 h) ; **e-mail de secours non configuré** ; sauvegardes dépendantes du plan Supabase |
| Données / réglages | ⚠️ | 13 comptes fictifs ; 29 valeurs « à confirmer » ; plages réseau CFB fictives ; fériés saisis pour 2026–2027 seulement |
| Propriété | ⚠️ | Supabase, Cloudflare et GitHub sur des comptes personnels |
| Juridique | ⏳ | Information du personnel, règlement de travail, conservation des IP : décision en attente (hors développement) |

## 2. Bloquants avant le pilote

| # | Sujet | Constat | Action | Qui |
|---|---|---|---|---|
| 1 | Base de production | Seul le projet de dev existe (données fictives) | Projet Supabase au nom du CFB (UE, plan Pro), `scripts/mise-en-production.sh` | IT |
| 2 | Données réelles | Personnes et soldes Dinclock pas encore reçus | Export Dinclock (voir « Questions à la RH ») puis Importer + Reprendre des soldes | RH → IT |
| 3 | Rappels par e-mail | `ms_client_id`, `ms_tenant_id`, `ms_expediteur` vides : seules les personnes ayant activé les notifications sur un appareil reçoivent les rappels (dev : 56 rappels non délivrés, 1 appareil abonné) | Soit inscription Entra ID avec envoi de mail (Mail.Send), soit activer les notifications sur chaque appareil du pilote (vérifié le jour 1) | IT (décision) |
| 4 | Réseau du CFB | Plages enregistrées fictives (`203.0.113.0/24` = plage de documentation) : l'indicateur « bureau / extérieur » et le télétravail automatique sont faux | Réglages › Réseau & fériés : IP publique(s) réelle(s) du CFB | IT |
| 5 | Réglages de connexion | Protection contre les mots de passe compromis **désactivée** | Supabase › Authentication : activer ; vérifier inscriptions coupées, 8 caractères min., Site URL + Redirect URLs | IT |
| 6 | Valeurs à confirmer | 29 réglages provisoires | Réponses RH (document « Questions à la RH ») | RH |
| 7 | Juridique | Information des participants, règlement de travail, durée de conservation des IP | Avis juridique / secrétariat social ; décision | Direction / IT |

## 3. Importants (avant la généralisation)

| Sujet | Action |
|---|---|
| Comptes au nom du CFB | Transférer Cloudflare (Worker `pointage`), GitHub, Supabase ; deux propriétaires minimum |
| Clés de notification | Régénérer les clés VAPID en production ; contact = `mailto:` d'une adresse IT du CFB |
| Fériés | Ajouter 2028 et les jours propres au CFB (27/09, ponts, récupérables) |
| Sauvegardes | Plan Pro (sauvegarde quotidienne) et **une restauration testée** sur un projet de test |
| Mot de passe admin | Le mot de passe de dev a circulé dans la conversation : le changer ; supprimer les comptes `@cfb.test` en production (le script le vérifie) |
| Branche Supabase liée à GitHub | Bloquée sur « CREATING_PROJECT » depuis le 04/11 ; les branches de prévisualisation sont facturées à l'heure : désactiver si inutile |
| Connexion Microsoft | Optionnelle ; même inscription Entra ID que l'e-mail |

## 4. Remarques des contrôles automatiques (traitées ou voulues)

| Remarque Supabase | Décision |
|---|---|
| 1 fonction sans `search_path` figé | **Corrigé** (migration 36) |
| 2 clés étrangères sans index | **Corrigé** (migration 36) |
| 67 fonctions `SECURITY DEFINER` appelables par un utilisateur connecté | Voulu : c'est l'API de l'appli ; chacune contrôle le rôle (`exiger_role`, `peut_voir`) — couvert par les tests SQL |
| 7 tables avec RLS sans politique | Voulu : aucun accès direct, uniquement par fonctions |
| 19 index jamais utilisés | Normal sur une base sans activité ; à revoir après 3 mois de production |

## 5. Améliorations possibles (non bloquantes)

- Fiche de temps (Mon mois › Heures) vue par la RH : rendre « À régulariser » cliquable (aujourd'hui : Gestion › Suivi RH).
- Carte « Bienvenue » de l'écran Pointer : la masquer quand le parcours d'accueil vient d'être fait (doublon léger).
- Tableau de bord des rapports : mettre en cache le mois clôturé si l'effectif dépasse ~300 personnes.

## 6. Ce qui a été vérifié

- Contrôles Supabase sécurité + performance ; tâches planifiées (4 actives, dernier passage OK) ; envois (HTTP 200) ; 0 erreur d'appli sur 7 jours.
- Historique des migrations aligné dépôt / dev (36/36).
- `npm audit` (0 vulnérabilité), recherche de secrets dans le dépôt (aucun), poids de l'appli.
- Test de charge : `app/e2e/charge.sql` (base locale ; à relancer sur une copie de production si l'effectif change).
