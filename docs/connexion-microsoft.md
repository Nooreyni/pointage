# Connexion Microsoft (Entra ID) et e-mails de secours — mise en place

Durée : environ 30 minutes. À faire par l'admin du tenant Microsoft 365 du CFB (portail Entra), puis dans le tableau
de bord Supabase. **Aucun secret ne passe par le chat ni par le dépôt** : on les colle directement dans Supabase.

Ce que ça apporte :
- **Connexion Microsoft** : chacun se connecte avec son compte du CFB (le même que pour Outlook / Teams), sans mot de
  passe propre à l'outil. Les comptes déjà créés avec un mot de passe sont **reliés automatiquement** (même adresse e-mail) :
  les deux façons de se connecter marchent.
- **E-mails de secours** : un rappel (oubli de pointage, réponse à une demande de congé…) part d'abord en notification sur
  le téléphone. Si la personne n'a pas activé les notifications, il part **par e-mail** à la place. Sans ce réglage, le
  rappel reste seulement dans l'onglet Alertes de l'appli.

Valeurs utiles :

| Quoi | Valeur |
|---|---|
| Adresse de l'appli | `https://pointage.nooreyni35.workers.dev` (à remplacer le jour où l'appli a son adresse CFB) |
| Adresse de retour Supabase (Redirect URI) | `https://xsgxsilezyfjotpsxhlw.supabase.co/auth/v1/callback` (projet actuel ; à changer si le projet change) |

---

## A. Connexion Microsoft

### A1. Inscrire l'appli dans Entra (portail.azure.com ou entra.microsoft.com)
1. **Microsoft Entra ID → Inscriptions d'applications → Nouvelle inscription**.
2. Nom : `CFB Pointage`.
3. Types de comptes pris en charge : **comptes de cet annuaire d'organisation uniquement** (locataire unique).
4. URI de redirection : plateforme **Web**, valeur = l'adresse de retour Supabase ci-dessus.
5. **Inscrire**. Noter l'**ID d'application (client)** et l'**ID de l'annuaire (locataire)** (page Vue d'ensemble).
6. **Certificats et secrets → Nouveau secret client** : description `Supabase`, expiration 24 mois.
   Copier la **valeur** tout de suite (elle n'est plus affichée ensuite). Noter la date d'expiration dans l'agenda IT.
7. **Configuration du jeton → Ajouter une revendication facultative → ID → `email` et `xms_edov`**
   (accepter l'ajout des autorisations Graph proposées). `xms_edov` confirme à Supabase que l'adresse est vérifiée :
   c'est ce qui permet la liaison automatique avec les comptes existants, en sécurité.
8. **Autorisations d'API** : `openid`, `email`, `profile`, `User.Read` (déléguées) suffisent → **Accorder le consentement
   administrateur** pour le CFB, pour que personne n'ait de fenêtre « autoriser l'appli ».

### A2. Brancher dans Supabase (supabase.com → projet → Authentication)
1. **Sign In / Providers → Azure** : activer.
   - Client ID = l'ID d'application (A1.5) ;
   - Secret = la valeur du secret (A1.6) ;
   - Azure Tenant URL = `https://login.microsoftonline.com/<ID de l'annuaire>` (limite la connexion aux comptes du CFB).
2. **URL Configuration** :
   - Site URL = l'adresse de l'appli ;
   - Redirect URLs : ajouter l'adresse de l'appli (et `http://localhost:5173` pour les tests).
3. **Sign In / Providers → Email** : laisser la connexion par mot de passe active (fiches de connexion, secours),
   mais **désactiver l'inscription libre** par e-mail : seuls la RH et l'IT créent les comptes.

### A3. Tester (5 minutes)
1. Ouvrir l'appli en navigation privée → **Se connecter avec Microsoft** → compte du CFB → on arrive sur l'écran Pointer.
2. Se connecter avec un compte **qui a déjà un mot de passe** (ex. un compte admin RH) : même personne, mêmes données.
   Dans **Mon compte**, la ligne Mot de passe indique la connexion Microsoft.
3. Un compte Microsoft d'une personne **pas encore importée** voit « Ton compte n'est pas encore enregistré dans
   CFB Pointage. Contacte la RH. » : normal, la RH doit d'abord créer sa fiche. Dès que la fiche existe, la connexion
   Microsoft suffit (pas besoin de fiche de connexion avec mot de passe).
4. Me dire « c'est fait » : je vérifie côté base que les comptes sont bien reliés (sans lire aucun secret).

À savoir :
- Avec la connexion Microsoft, la **double authentification** et les règles de mot de passe sont celles de Microsoft 365
  (gérées par l'IT dans Entra), pas celles de l'outil.
- Quand une personne quitte le CFB, **désactiver son compte Microsoft** coupe la connexion Microsoft. Dans tous les cas,
  la **date de sortie** (Gestion › Personnes) coupe l'accès à l'outil le lendemain, quelle que soit la façon de se connecter.

---

## B. E-mails de secours (même portail, 10 minutes de plus)

On utilise une **inscription séparée**, qui ne peut envoyer que depuis une seule boîte : si elle fuitait, elle ne
permettrait pas d'écrire au nom de quelqu'un d'autre.

1. Créer une **boîte partagée** dans Exchange, par ex. `pointage@centrefamilial.be` (une boîte partagée ne demande pas
   de licence).
2. Entra → **Nouvelle inscription** : `CFB Pointage – envoi`, locataire unique, **sans** URI de redirection.
3. **Autorisations d'API → Microsoft Graph → Autorisations d'application → `Mail.Send`** → consentement administrateur.
4. **Certificats et secrets** → nouveau secret (24 mois) → copier la valeur.
5. Limiter l'appli à la seule boîte `pointage@` (Exchange Online PowerShell, une fois) :
   ```powershell
   New-DistributionGroup -Name "CFB Pointage envoi" -Type Security -Members pointage@centrefamilial.be
   New-ApplicationAccessPolicy -AppId <ID de l'appli envoi> -PolicyScopeGroupId "CFB Pointage envoi" -AccessRight RestrictAccess -Description "CFB Pointage : envoi depuis pointage@ uniquement"
   ```
6. Supabase → **SQL Editor** → coller et compléter (rien n'est enregistré ailleurs) :
   ```sql
   select pointage.configurer('ms_tenant_id', '<ID de l''annuaire>'),
          pointage.configurer('ms_client_id', '<ID de l''appli envoi>'),
          pointage.configurer('ms_client_secret', '<valeur du secret>'),
          pointage.configurer('ms_expediteur', 'pointage@centrefamilial.be');
   ```
7. Me dire « c'est fait » : j'envoie un e-mail de test et je vérifie l'état du système (Réglages › Journal).

---

## C. Plus tard
- Secrets : expiration dans 24 mois. Un mois avant, en créer un nouveau et le recoller (A2.1 et B6). L'état du système
  signale les envois en erreur si on oublie.
- Si le projet Supabase change (passage au nom du CFB) : refaire A1.4 (adresse de retour) et A2, et B6.
