# Passation — CFB Pointage

Pour la personne qui reprend l'outil (IT du CFB ou prestataire). À lire avec `README.md`, `CLAUDE.md` (règles métier confirmées)
et `docs/deploiement.md` (installation détaillée).

## 1. L'outil en une page

| Élément | Où | Rôle |
|---|---|---|
| Appli (PWA, React) | `app/` | Écrans. Fichiers statiques : Cloudflare Pages ou n'importe quel serveur web (IIS, nginx) |
| Base PostgreSQL | `supabase/migrations/` | **Toutes les règles** : calculs d'heures, droits (RLS), validation, compteurs, rappels |
| Fonctions serveur (Deno) | `supabase/functions/` | `envoyer-notifications` (push + e-mail), `gerer-comptes` (mots de passe), `agenda` (lien Outlook) |
| Tâches planifiées | pg_cron (dans la base) | rappels (15 min), envoi (5 min), conservation (nuit), anonymisation (nuit) |
| Démo | `app/src/lib/demo.ts` | Données fictives en mémoire (`?demo=1`), pour montrer l'outil sans serveur |

Principe : l'appli n'écrit **jamais** directement dans les tables. Tout passe par des fonctions `public.*` qui revérifient le rôle
(`pointage.exiger_role`) ; les lectures passent par des vues filtrées par la RLS (`pointage.peut_voir`). Les tables sont dans le
schéma privé `pointage`.

## 2. Comptes et propriété

- **Supabase** : l'organisation doit appartenir au CFB (adresse générique, ex. it@…), avec au moins deux propriétaires.
- **GitHub** (`Nooreyni/pointage`) : transférer le dépôt vers un compte ou une organisation du CFB (Settings › Transfer).
- **Cloudflare** : compte au nom du CFB ; Worker `pointage` (dev : https://pointage.nooreyni35.workers.dev, compte personnel à transférer) (fichiers statiques, `wrangler.jsonc` à la racine du dépôt).
  Workers Builds : branche `main`, commande de build `npm run build`, déploiement `npx wrangler deploy` (marche depuis la
  racine ou depuis `app/`). Sans variables, le build se relie au projet **dev** (`app/.env.production`) ; en production,
  définir `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_CONNEXION_DEV=0`, `VITE_MODE_DEMO=0` dans les variables de build.
- **Microsoft Entra ID** (connexion Microsoft, e-mails) : inscription d'application gérée par l'IT du CFB — pas à pas dans `docs/connexion-microsoft.md` (secrets valables 24 mois : à renouveler).
- Aucun secret n'est dans le dépôt. Les clés d'envoi sont dans la table `pointage.configuration` (jamais exposée).

## 3. Mise en production (première fois)

1. Créer le projet Supabase de **production** (région UE, plan Pro conseillé pour les sauvegardes quotidiennes).
2. Lancer `scripts/mise-en-production.sh` (variables décrites en tête du script) : migrations, fonctions, clés d'envoi,
   contrôles, appli. Relançable : ce qui est déjà fait est sauté.
3. Premier admin : `psql "$DB_URL" -v prenom=… -v nom=… -v email=… -v service=IT -f scripts/premier-admin.sql`.
4. Tableau de bord Supabase › Authentication :
   - Providers › Email : **désactiver « Allow new users to sign up »** ;
   - Password : **8 caractères minimum** ; activer la protection contre les mots de passe ayant fuité ;
   - Providers › Azure : activer (connexion Microsoft) ;
   - URL Configuration : Site URL = adresse de l'appli.
5. Domaine : `pointage.<domaine>` vers Cloudflare Pages ; renseigner `appli_url` (fait par le script).
6. Contrôle final : `psql "$DB_URL" -f scripts/verifier-installation.sql` → tout ✅ sauf « valeurs à confirmer » tant que la
   RH ne les a pas validées.

## 4. Mises à jour

1. Développer sur une branche ; la CI GitHub doit être verte (base, appli, service d'envoi, parcours démo).
2. Tester en réel : `npm run e2e:reel` (voir §6).
3. Appliquer sur **dev** d'abord, puis `scripts/mise-en-production.sh` sur la production.
4. Comparer l'empreinte des fonctions (dernière requête de `verifier-installation.sql`) entre dev et production.
5. Règle des migrations : jamais modifier une migration déjà appliquée ; en ajouter une nouvelle. Toute migration qui
   crée une fonction se termine par `select pointage.fixer_fuseau();`.

## 5. Tâches courantes

| Besoin | Où |
|---|---|
| Nouvelle personne, compte, mot de passe oublié | Gestion › Personnes (RH, admin RH, direction, admin) |
| Changer une règle (pause, rappels, indemnité…) | Gestion › Réglages › Paramètres (tracé dans le Journal) |
| Chef de service, remplacement temporaire | Réglages › Services ; Réglages › Accès (avec date de fin) |
| Clôturer le mois | Gestion › Suivi RH › Clôture |
| Qui a modifié quoi | Gestion › Réglages › Journal |
| Notifications qui ne partent plus | `select pointage.reveiller_envoi();` puis `select status_code, content from net._http_response order by id desc limit 3;` |
| Restaurer | Supabase › Database › Backups (plan Pro : quotidien ; PITR en option) |
| Lancer un service (comptes, fiches, relances) | Réglages › Lancement : créer les comptes d'un service en une fois et imprimer les fiches de connexion (QR) ; voir qui ne s'est jamais connecté, ne pointe pas ou n'a pas les notifications, et le relancer |
| Faire tester l'outil (avant un lancement, un nouveau service) | Réglages › Avis des testeurs : désigner les testeurs, lire leurs avis, « Traité ». Le testeur a une visite guidée, un bouton « Mon avis » et « Commenter » sur chaque réglage |
| L'outil tourne-t-il bien ? | Réglages › Journal › « État du système » (tâches planifiées, envois, erreurs). Vérifié toutes les heures (`cfb-surveillance`) ; alerte à l'admin général si problème, une fois par jour et par problème |
| Un écran plante chez quelqu'un | Réglages › Journal › « Erreurs de l'appli » (remontées automatiquement, 7 derniers jours) |
| Reprendre les soldes de Dinclock | Gestion › Personnes › Reprendre des soldes (CSV : email ; compteur ; solde ; date) |

## 6. Tests

| Commande | Ce qui est vérifié |
|---|---|
| `supabase/tests/run.sh` | Toutes les migrations + 308 scénarios SQL (horloge figée) |
| `cd app && npm test` | Calculs, file hors ligne, chiffrement Web Push |
| `npm run dev` puis `npm run e2e` | Démo : 5 rôles × mobile/PC, accessibilité, superposition, aide, validation, fiches |
| `npm run e2e:reel` | **Appli réelle** sur une base locale (22 parcours) : 7 comptes × mobile/PC, pointer, demander, valider, créer une fiche, reprendre des soldes, accès, réglages |
| `VITE_MODE_DEMO=1 npm run build`, `npx vite preview --port 4173`, puis `npm run e2e:pwa` | PWA : installable (critères de Chrome), tous les écrans préchargés, hors ligne, mise à jour proposée |

`e2e:reel` démarre une base PostgreSQL 16 locale (`e2e/base-locale.sh`), un mini serveur compatible Supabase
(`e2e/mini-supabase.cjs`, tests uniquement) et l'appli ; il vérifie qu'aucun appel d'API n'échoue. Il ne couvre pas les
fonctions serveur (Deno), testées à part, ni Microsoft.

### PWA (appli installable)
- `public/sw.js` : service worker. La liste des fichiers à précharger et la version sont **inscrites au build**
  (`vite.config.ts › cfb-precache-pwa`) : chaque déploiement change la version.
- Nouvelle version : elle attend ; l'appli affiche « Nouvelle version disponible › Mettre à jour » (jamais de bascule
  en plein travail). Vérification au retour sur l'appli et toutes les heures.
- Hors ligne : tous les écrans s'ouvrent ; les pointages sont mis en file et envoyés au retour du réseau. Les données
  (API Supabase) ne sont **jamais** mises en cache par le service worker.
- Installation : Mon compte › « Appli sur cet appareil » (bouton sur Android / PC ; marche à suivre sur iPhone,
  obligatoire pour les notifications d'Apple) ; invitation discrète sur l'écran Pointer (mobile, « Plus tard » = 30 jours).
- Servir `sw.js`, `index.html` et `manifest.webmanifest` sans cache (`public/_headers` pour Cloudflare ; à reproduire
  sur IIS / nginx).

## 7. Points d'attention

- `lib/demo.ts` reproduit le comportement de la base pour la démo : une nouvelle règle doit y être répercutée (sinon la démo
  ment). `e2e:reel` sert de filet.
- Les valeurs marquées « À confirmer » (Réglages › Paramètres) sont des propositions : à valider par la RH avant la bascule.
- Décisions légales en attente (le développeur ne tranche pas) : conservation des IP, justificatifs médicaux, information du
  personnel / règlement de travail, journal d'audit après anonymisation.
