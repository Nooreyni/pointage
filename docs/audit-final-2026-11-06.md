# Audit final approfondi — 06/11/2026

**Verdict : le logiciel est prêt pour un pilote ; l'organisation autour ne l'est pas encore.**
Le code, la sécurité et les tests sont au niveau d'un produit professionnel. Ce qui manque est de l'ordre de la mise en
service : comptes au nom du CFB, données RH définitives, configuration e-mail et réseau, décisions RH / juridiques,
et un point nouveau : **la base « dev » contient désormais le personnel réel**.

Méthode : toutes les suites de tests relancées, base de dev interrogée telle qu'elle est (personnel réel importé), contrôles
automatiques Supabase, test de charge, relecture du dépôt et des documents. Notes sur 5 (5 = rien à redire pour un pilote).

## 1. Tableau de bord

| Axe | Note | En une phrase |
|---|---|---|
| Fonctionnalités | 4,5 | Couverture complète du besoin Dinclock + plus (accueil, signalements, horaires, rappels) ; manque l'export Partena (format inconnu) |
| Fonctionnement / fiabilité | 4,5 | 0 échec de tâche planifiée sur 7 j, 0 erreur d'appli, 0 envoi en erreur ; règles en base, testées |
| UX / UI | 4,5 | Simple, cohérent PC + mobile, accessible (contrôle automatique), aide intégrée ; 2 finitions mineures |
| Sécurité | 4,5 | Rien d'accessible sans connexion, RLS partout, rôles revérifiés côté serveur ; 2 réglages Supabase à faire |
| Performance | 5 | 124 personnes / 10 000 pointages : pointer 4 ms, écrans de gestion < 1 s, appli 154 Ko |
| Robustesse | 4,5 | Hors ligne, double appui, mois clôturés verrouillés, données immuables, transactions ; pas de déclenchement d'alerte si un envoi tombe en panne |
| Automatisation | 4 | Rappels, relances, prorata, reports, anonymisation, déploiement continu ; e-mail de secours non branché |
| Intelligence | 4 | Horaires appris, propositions de correction, détection d'anomalies, décomptes et alertes de solde, télétravail auto |
| Ouverture / intégration | 3 | Exports Excel / CSV / XML, agenda Outlook (iCal), connexion Microsoft prête ; Partena et Entra ID non branchés, pas d'API publique |
| Maturité / finition | 4 | 38 migrations, 338 + 23 + 17 + 24 + 5 tests, CI verte, docs de passation ; quelques docs à tenir à jour |
| Durabilité / maintenabilité | 4 | Stack simple (PostgreSQL + React), tout est dans le dépôt, tests pour chaque règle ; une seule personne connaît le projet |
| Gestion / gouvernance | 3 | Journal de toutes les modifications, rôles clairs ; **comptes techniques personnels**, décisions RH et juridiques en attente |
| Risque global | Moyen | Faible côté technique, **moyen côté organisation et données personnelles** (voir §3) |
| Readiness pilote | 3,5 | Prêt dès que les 6 actions « Avant le pilote » sont faites |

## 2. Constats par axe

### Fonctionnalités et pertinence
- Pointage (1 appui, hors ligne, télétravail auto), congés (jours / ½ / heures, décompte avant envoi), validation décentralisée,
  compteurs et reports, clôture, rapports direction / RH / CPAS, rappels, agenda Outlook, PWA installable.
- Ajouts récents pertinents pour l'usage réel : import du personnel d'avance, personnes visibles seulement avec un compte,
  chef sans compte = absent (demandes à la direction), signalement d'une info fausse, horaires habituels, parcours d'accueil.
- Manques assumés : export Partena (format à obtenir du secrétariat social), justificatifs désactivés (décision RH).

### Fonctionnement (base de dev, réel)
| Contrôle | Résultat |
|---|---|
| Tâches planifiées (rappels 15 min, envoi 5 min, conservation, anonymisation) | 4 actives, **0 échec sur 7 jours** |
| Envois vers le service de notifications | 0 réponse en erreur sur 7 jours |
| Erreurs remontées par l'appli | 0 sur 7 jours |
| Journal des modifications | 353 lignes, auteur et date à chaque changement (ex. chefs désignés le 06/11 à 11:25 par l'admin) |
| Personnes | 67 (66 réelles importées + 1 admin) ; 4 comptes actifs (admin + 3 admin RH) |
| **Qui reçoit les demandes aujourd'hui** | **Personne dans aucun service** : aucun chef ni membre de la direction n'a encore de compte (seul l'admin peut valider) |

### UX / UI et finition
- Points forts : un geste pour pointer, densité adaptée à ~100 personnes (pagination, une ligne par personne), en-tête épuré,
  aide en sommaire, accueil passable, contrôles d'accessibilité automatiques à chaque version (aucune violation).
- Finitions restantes : carte « Bienvenue » en doublon avec le parcours d'accueil ; « À régulariser » non cliquable dans la
  fiche de temps vue par la RH ; pas d'obligation de changer le mot de passe provisoire à la première connexion.

### Sécurité
| Contrôle | Résultat |
|---|---|
| Fonctions ou tables accessibles sans connexion | **0** |
| Tables sans protection par ligne (RLS) | **0** ; vues toutes en « droits de l'utilisateur » |
| Fonctions privilégiées sans chemin de recherche figé | **0** |
| Justificatifs | espace de stockage **privé** |
| Secrets dans le dépôt / dépendances vulnérables | aucun / 0 |
| Protection contre les mots de passe compromis (Supabase Auth) | **désactivée** — à activer |
| Mots de passe provisoires | ont transité par la conversation : à changer à la 1re connexion (pas encore imposé par l'appli) |
| Double authentification RH / direction | prête, désactivée (décision du 02/11) |

### Fiabilité, robustesse, performance
- Calculs et règles dans la base, couverts par 338 tests (horloge figée, fuseau Bruxelles) ; parcours réels testés de bout en bout.
- Pointages, mouvements de compteurs et journal immuables ; mois clôturé verrouillé ; double appui filtré ; file hors ligne.
- Charge : voir tableau §1 ; base 15 Mo.
- Angle mort : si l'envoi des notifications s'arrête, personne n'est prévenu (pas d'alerte de supervision).

### Automatisation et intelligence
- Automatisé : rappels d'oubli (à l'heure habituelle de chacun), relances de demandes, rappels de fin de mois, reports de
  compteurs, prorata des congés, anonymisation des partis, déploiement (Cloudflare à chaque version sur `main`), CI GitHub.
- Intelligent : heures habituelles apprises (ou déclarées), heure proposée pour corriger, solde restant affiché avant
  d'envoyer, équipe absente montrée au valideur, regroupement des petits services dans les statistiques (confidentialité).
- Non automatisé : e-mail de secours (non configuré), import Dinclock (manuel, outillé), export Partena.

### Ouverture et intégration
| Intégration | État |
|---|---|
| Excel / CSV / XML (fiches, récaps, rapports) | ✅ |
| Agenda Outlook / Google / Apple (lien iCal personnel) | ✅ |
| Connexion Microsoft (Entra ID) | prête dans le code, **inscription Entra à faire** |
| E-mails via Microsoft 365 | prêt dans le code, **identifiants à fournir** |
| Partena | ⏳ format à obtenir |
| Teams, API publique | non prévus (hors MVP) |
| Hébergement interne futur | possible : PostgreSQL standard + fichiers statiques |

### Gestion, durabilité, professionnalisme
- Documentation : passation, déploiement, pilote, questions RH, audits ; README et règles du projet à jour.
- Propriété : Supabase, Cloudflare (Worker `pointage`) et GitHub sont sur des **comptes personnels** → à transférer.
- Dépendance à une seule personne : atténuée par les tests et la doc, pas supprimée (prévoir un 2e administrateur technique).
- Branche Supabase liée à GitHub bloquée depuis le 04/11 : à vérifier (facturation possible à l'heure).

## 3. Risques

| # | Risque | Probabilité | Impact | Parade |
|---|---|---|---|---|
| R1 | **Données personnelles réelles dans un projet « dev » sur un compte personnel** (noms, e-mails, rôles de 66 personnes) | Certain (c'est le cas) | Élevé (RGPD, propriété) | Décider : soit ce projet devient la production et passe au nom du CFB, soit les vraies données vont dans un projet CFB et dev redevient fictif — **à trancher par toi** |
| R2 | Demandes sans destinataire tant que direction et chefs n'ont pas de compte | Élevé | Moyen | Créer d'abord les comptes direction + chefs |
| R3 | Rappels non reçus par ceux qui n'activent pas les notifications (e-mail non branché) | Élevé | Moyen | Brancher l'e-mail Microsoft 365 ou activer les notifications sur chaque appareil le jour 1 |
| R4 | Soldes / prorata faux à cause des valeurs provisoires (date d'entrée = création M365, régime 38 h pour tous) | Élevé si non corrigé | Élevé | La RH corrige avant toute attribution de congés ; reprise des soldes Dinclock |
| R5 | Indicateur bureau / extérieur faux (plages réseau fictives) | Certain | Faible à moyen | Saisir l'IP publique du CFB |
| R6 | Mot de passe provisoire jamais changé | Moyen | Moyen | Imposer le changement à la 1re connexion (amélioration proposée) |
| R7 | Panne silencieuse des envois | Faible | Moyen | Alerte à l'IT si un envoi échoue ou si une tâche planifiée ne tourne plus |
| R8 | Départ de la seule personne qui connaît l'outil | Moyen | Élevé | Comptes au nom du CFB, 2e admin technique, passation |

## 4. Plan d'action

**Avant le pilote (bloquant)**
1. **R1** : décider du statut du projet Supabase actuel (production au nom du CFB, ou projet CFB séparé) — décision IT / direction.
2. Créer les comptes de la **direction et des chefs** (Brigitte, Fernando, Audrey, Monica, Emmanuel, Joëlle Devolder, ta fiche).
3. La RH corrige sur chaque fiche : **date d'entrée, régime, matricule, CPAS des ISP** ; puis reprise des soldes Dinclock.
4. Saisir l'**IP publique du CFB** (Réglages › Réseau & fériés).
5. Supabase › Authentication : **protection des mots de passe compromis**, Site URL et Redirect URLs.
6. Rappels : brancher l'**e-mail Microsoft 365** ou activer les notifications sur chaque appareil du pilote.

**Avant la généralisation**
7. Transférer Cloudflare, GitHub, Supabase au nom du CFB (2 propriétaires).
8. Trancher les 29 réglages « à confirmer » (RH) ; fériés 2028 et jours propres au CFB.
9. Format Partena ; inscription Entra ID (connexion Microsoft + e-mails).
10. Avis juridique : information du personnel, règlement de travail, conservation des IP.

**Améliorations proposées**
- Changement de mot de passe **obligatoire** à la première connexion — non retenu pour l'instant.
- ✅ (06/11) **Alerte à l'IT** si l'envoi des notifications ou une tâche planifiée échoue : vérification toutes les heures
  (`cfb-surveillance`), alerte à l'admin général, « État du système » dans Réglages › Journal (migration 39). Couvre R7.
- ✅ (06/11) « À régulariser » cliquable dans la fiche de temps (soi-même, RH, direction, admin) ; carte « Bienvenue »
  masquée une fois le parcours d'accueil terminé.

## 5. Preuves

| Vérification | Résultat (06/11/2026) |
|---|---|
| Tests SQL | 338 / 338 |
| Tests unitaires | 23 / 23 |
| Parcours démo (5 rôles, mobile + PC, accessibilité) | 17 / 17 |
| Parcours appli réelle (base locale) | 24 / 24 |
| PWA (installable, hors ligne, mise à jour) | 5 / 5 |
| Typage TypeScript | 0 erreur |
| Dépendances vulnérables | 0 |
| Migrations dev = dépôt | 38 / 38 |

_Mise à jour 06/11 après les améliorations : tests SQL 346 / 346, migrations dev = dépôt 39 / 39, e2e démo 17 / 17, e2e réel 24 / 24._
