# Installation et mise en service — CFB Pointage

Guide pour installer l'outil (CFB ou autre structure). Aucune valeur propre à une installation n'est dans le code :
tout se règle dans la base (paramètres + configuration) ou dans l'écran Admin.

## 1. Composants

| Élément | Rôle | Hébergement conseillé | Coût |
|---|---|---|---|
| Base PostgreSQL + API + authentification | Données, règles, droits | Supabase (ou Supabase auto-hébergé sur serveur interne) | 0 € (plan gratuit) à 25 €/mois |
| Fonction `envoyer-notifications` | Push + e-mail de secours | Supabase Edge Functions (Deno) | inclus |
| Appli (PWA) | Écrans | Cloudflare Pages, ou tout serveur web statique (IIS, nginx…) | 0 € |

## 2. Base de données

1. Créer le projet Supabase (organisation **au nom de la structure**, pas d'un compte personnel).
2. Appliquer les migrations `supabase/migrations/*.sql` **dans l'ordre** (éditeur SQL ou `supabase db push`).
3. Réglages du projet (tableau de bord Supabase) :
   - *Authentication → Providers* : activer **Azure (Microsoft Entra ID)** ;
   - *Authentication → Providers → Email* : **désactiver l'inscription** (« Allow new users to sign up ») en production ;
   - *Authentication → Password security* : activer la protection des mots de passe compromis (si l'e-mail reste utilisé).
4. Fuseau : géré par les migrations (Europe/Brussels), rien à faire.
5. Vérifier les tâches planifiées : `select jobname, schedule from cron.job;` → `cfb-rappels` (15 min),
   `cfb-envoi` (5 min), `cfb-conservation` (03:17).

## 3. Notifications (push + e-mail de secours)

1. Déployer la fonction : `supabase functions deploy envoyer-notifications --no-verify-jwt`
   (elle vérifie elle-même le secret transmis par la base).
2. Générer la configuration (une fois par installation) :
   ```bash
   node scripts/generer-config-envoi.mjs https://<projet>.supabase.co https://<adresse-appli> mailto:<it@structure>
   ```
   Exécuter le SQL affiché dans l'éditeur SQL. **Ne pas le committer** (il contient la clé privée).
3. E-mail de secours via Microsoft 365 (facultatif, recommandé) :
   - Entra ID → *Inscriptions d'applications* → nouvelle appli « CFB Pointage – envoi » ;
   - *Autorisations d'API* → Microsoft Graph → **Application** → `Mail.Send` → consentement administrateur ;
   - *Certificats & secrets* → nouveau secret client ;
   - Restreindre l'appli à la seule boîte expéditrice (Exchange Online PowerShell) :
     `New-ApplicationAccessPolicy -AppId <client_id> -PolicyScopeGroupId <boite> -AccessRight RestrictAccess`
   - Puis :
     ```sql
     select pointage.configurer('ms_tenant_id', '<tenant>'), pointage.configurer('ms_client_id', '<client_id>'),
            pointage.configurer('ms_client_secret', '<secret>'), pointage.configurer('ms_expediteur', 'pointage@<domaine>');
     ```
4. Contrôle : `select pointage.reveiller_envoi();` doit renvoyer `true`, puis
   `select status_code, content from net._http_response order by id desc limit 1;` → `200 {"traitees":…}`.
5. Réglages fonctionnels (Admin → Paramètres → Notifications) : push actif, e-mail de secours, durée de validité.

Chaque personne active ensuite les notifications sur son téléphone / PC (onglet **Alertes**, ou bandeau sur l'écran Pointer).
Sur iPhone : ajouter d'abord l'appli à l'écran d'accueil (exigence d'Apple, iOS ≥ 16.4).

## 4. Appli (front)

1. Variables de build (`app/.env.production`) : `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (clé **publique** « publishable »).
2. `cd app && npm ci && npm run build` → dossier `app/dist` à publier.
3. Cloudflare Pages : dossier `app/dist`, commande `npm run build`, racine `app`. Serveur interne : copier `dist/`
   (fonctionne aussi dans un sous-dossier, ex. `https://intranet/pointage/`).
4. Renseigner l'adresse de l'appli (liens des e-mails) : `select pointage.configurer('appli_url', 'https://…');`

## 5. Données de départ

Écran **Admin** (rôle admin général) : services et chefs, régimes de travail, personnes, réseaux du bureau (IP),
jours fériés, paramètres (marqués « À confirmer » tant qu'ils sont provisoires), compteurs et leur règle de report.

## 6. Tests

| Commande | Contenu |
|---|---|
| `supabase/tests/run.sh` | Toutes les migrations + 200 scénarios SQL sur un PostgreSQL 16 jetable, horloge figée (paquet `faketime`) |
| `cd app && npm test` | Calculs, file hors ligne, chiffrement Web Push (vecteur officiel RFC 8291) |
| `node supabase/functions/envoyer-notifications/integration.test.mjs supabase/functions/envoyer-notifications/index.ts [email]` | Service d'envoi réel (Deno) contre une fausse API et un faux service push qui déchiffre le message |
