# Audit approfondi — CFB Pointage (01/11/2026)

Suite de l'audit du 31/10 (`audit-2026-10-31.md`, R1–R15 : tous corrigés sauf R6, en attente de la RH).
Périmètre : sécurité, règles de calcul et cas limites, UX mobile, accessibilité, performance, exploitation, code.

## 1. Méthode et résultats des contrôles

| Contrôle | Outil | Résultat |
|---|---|---|
| Scénarios métier + sécurité (rôles, droits, workflow, calculs, purge, notifications, justificatifs) | 226 tests SQL, PostgreSQL 16, horloge figée | **226 / 226** |
| Calculs front, file hors ligne, chiffrement push (vecteur RFC 8291), CSV, inactivité | Vitest | **18 / 18** |
| Service d'envoi réel (Deno) contre fausse API + faux service push qui déchiffre | Test d'intégration | **7 / 7** |
| Parcours navigateur : 5 rôles × tous les onglets, mobile + PC | Playwright | 0 erreur, 0 débordement |
| Accessibilité WCAG 2 A/AA : tous les écrans, connexion, 4 fenêtres | axe-core | **0 violation** |
| Politique de sécurité de contenu (CSP) sur tous les écrans | Playwright + en-têtes réels | 0 violation |
| Dépendances | `npm audit` | 0 vulnérabilité |
| Typage | TypeScript strict, variables / paramètres inutilisés interdits | 0 erreur |
| Parité code testé / code déployé (Supabase dev) | Empreinte des 99 fonctions | Identique |
| Tâches planifiées (24 h) | `cron.job_run_details` | 0 échec (rappels 96/96, envoi 13/13) |
| Appels du service d'envoi (24 h) | `net._http_response` | 100 % en 200 |
| Alertes Supabase (sécurité / performance) | Advisors | Seulement les alertes attendues (voir §5) |

## 2. Constats et corrections apportées pendant l'audit

| # | Gravité | Constat (preuve) | Correction |
|---|---|---|---|
| A1 | 🟠 Moyen | 26 fonctions internes (purge, notifications, reports…) exécutables par tous les rôles (droit PostgreSQL par défaut). Non atteignables aujourd'hui (schéma non exposé, `anon` sans accès, GraphQL absent) mais exposées si on active GraphQL ou le schéma | Migration 20 : seules les **11** fonctions nécessaires aux vues / règles d'accès restent ouvertes aux connectés ; nouvelles fonctions fermées par défaut ; 4 tests |
| A2 | 🟠 Moyen | Double appui sur « Pointer » → entrée **et** sortie à 3 s d'intervalle (reproduit) | Migration 22 : 2e pointage < 60 s refusé avec message « Tu viens déjà de pointer… annule-le si erreur ». Réglable (`anti_rebond_s`, 0 = jamais) |
| A3 | 🟠 Moyen | 3 h prestées un samedi → +3 h de **boni automatique** (reproduit), contraire à la règle « pas d'heures sup, exceptions validées manuellement » | Migration 22 : jour non prévu (week-end, férié, jour off d'un temps partiel) → **heures à valider** par N+1 / RH. Réglable (`jour_non_prevu_a_valider`) |
| A4 | 🟡 Faible | Export CSV de la fiche de temps sans neutralisation des formules (les autres exports l'avaient) | Fonction d'export commune + tests |
| A5 | 🟡 Faible | Mobile : listes RH / Admin écrasées (« Emma / Claes · / Accident / de travail ») | Lignes qui passent à la ligne proprement partout |
| A6 | 🟡 Faible | Le 1er du mois, « Mes heures » s'ouvre sur un mois vide | Ouvre le mois précédent ce jour-là |
| A7 | ⚪ Info | Le passage de reprise réveillait le service d'envoi toutes les 5 min même sans rien à envoyer | Appel seulement si la file n'est pas vide |
| A8 | ⚪ Info | « Boni du jour » vide affiché en vert ; 3 exports de code mort | Corrigés |

Cas limites vérifiés sans défaut : passage à l'heure d'hiver (8 h réelles comptées), personne partie (accès coupé),
pointage futur / antidaté, chevauchement de congés, férié dans un congé, demi-journée en temps partiel,
mois clôturé (seul un justificatif peut encore être ajouté), appareil partagé (file hors ligne et notifications par personne).

## 3. Sécurité — synthèse

| Couche | État |
|---|---|
| Authentification | Liaison compte ↔ personne seulement si identité vérifiée (SSO) ; personne partie = accès coupé ; déconnexion après inactivité (réglable) |
| Autorisation | Toutes les écritures par fonctions contrôlant le rôle ; lectures par vues filtrées (RLS sur 100 % des tables, vues `security_invoker`) ; moindre privilège sur le schéma interne |
| Données sensibles | IP visibles selon réglage ; justificatifs (santé) : RH seulement par défaut ; motifs d'absence : N+1 ; stats anonymisées sous le seuil |
| Secrets | Aucun secret dans le code ni l'historique Git (vérifié) ; configuration d'envoi dans une table non exposée, remise contre secret partagé |
| Navigateur | CSP stricte, anti-iframe, HSTS ; exports CSV neutralisés ; aucun `innerHTML` / `eval` |
| Traçabilité | Journal d'audit en ajout seul ; pointages jamais supprimés hors purge de conservation réglée |

## 4. Points ouverts — décisions et actions hors code

| Priorité | Sujet | Qui |
|---|---|---|
| P0 | **Plan Supabase de production** : le plan gratuit met le projet en pause après 7 jours d'inactivité et ses sauvegardes sont incertaines selon les sources → **plan Pro (25 $/mois)** pour la prod, ou sauvegarde externe à organiser (attention RGPD) | Ousmane |
| P0 | Connexion Microsoft (Entra ID), désactiver l'inscription e-mail, protection mots de passe compromis | Ousmane (admin tenant / tableau de bord) |
| P1 | Valider les **paramètres « À confirmer »** (pause, seuils, max, report des compteurs R6, anti double appui, jour non prévu) | RH |
| P1 | Justificatifs visibles par le N+1 ? (données de santé, désactivé par défaut) | Ousmane (RGPD) |
| P1 | E-mail de secours : enregistrer l'application Microsoft 365 (Mail.Send restreint à la boîte expéditrice) | Ousmane |
| P2 | Format d'export Partena | RH / secrétariat social |
| P2 | Transférer le dépôt GitHub vers une organisation CFB | Ousmane |
| P3 | Travail de nuit (entrée avant minuit, sortie après) : compté en 2 journées incomplètes — hors besoin actuel (bureau) | À confirmer |

## 5. Alertes Supabase restantes (attendues)
- « Fonction SECURITY DEFINER exécutable par authenticated » (43) : c'est l'API voulue ; chaque fonction contrôle le rôle (couvert par les tests).
- « RLS sans politique » (4 tables internes) : volontaire — invisibles par l'API.
- « Protection des mots de passe compromis désactivée » : réglage du tableau de bord (P0 ci-dessus).

## 6. Verdict
Aucune anomalie bloquante ni erreur connue côté code. Le produit est **prêt pour une phase pilote** dès que les actions
P0 (plan Supabase, Entra ID) sont faites et que la RH a validé les paramètres provisoires.
