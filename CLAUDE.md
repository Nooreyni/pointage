# CFB Pointage — règles du projet

## Règles de travail (Ousmane)
- **Ne jamais utiliser Vercel.**
- **Légal / RGPD : ne rien décider.** Proposer l'option, Ousmane tranche.
- Ne pas inventer de règle métier : si ce n'est pas confirmé ici ou vu dans Dinclock, demander.
- Dinclock et SD Worx = sources d'inspiration, en **lecture seule** (aucune modification).
- Le cadrage initial (chat) est une base de discussion, pas une spec figée : stack et architecture révisables.

## Objectifs non négociables
- Complet en fonctionnalités, **simple** à l'écran et à l'usage, moderne, très performant.
- Coût faible pour le CFB, fiable.
- **Propriété transférable** au CFB (pas de dépendance à un compte perso), hébergeable sur un
  serveur interne CFB à terme.

## Vocabulaire
- Toujours des **rôles génériques**, jamais de noms de personnes (« la direction », « chef de service »,
  « RH », « admin RH », « responsable ISP »). Les titulaires changent.

## Règles métier confirmées (31/10/2026)
| Sujet | Règle |
|---|---|
| IP | **Adresse IP stockée** (comme Dinclock) + indicateur réseau CFB / externe. **Pas** d'infos appareil, **pas** de géolocalisation. Durée de conservation : à décider par Ousmane |
| Hiérarchie | Direction → chefs de service, équipe RH (3 RH + 1 admin RH) et services sans équipe (logistique, SIPP…) → employés des services |
| Validation congés | **Décentralisée** : le N+1 accepte ou refuse, **c'est définitif**. La RH ne fait que constater |
| N+1 | Employé → son chef de service. Chef de service, RH, admin RH, services sans équipe → la direction |
| Direction | Peut accepter/refuser **pour tout le monde**. Par défaut ne reçoit que ses N-1 ; reçoit les demandes d'un service si son chef est absent. Peut régler quels types / quelles personnes lui remontent |
| ISP | Rattaché à un service. Accepté par **le chef de service OU** la responsable ISP / admin RH (l'un ou l'autre). Rapports d'heures pour le CPAS |
| Rappels | Automatiser les relances (oublis de pointage, anomalies, demandes en attente) avant la fin du mois pour décharger la RH |
| Temps partiels | Existent (4/5, 37h30, horaires variables par jour) — voir docs/dinclock-audit-2026-10-30.md |
| Hors périmètre | Paie, fiches de paie, planning, notes de frais, biométrie |
| Visibilité collègues | Voir qui est présent / absent (sans motif), surtout dans son équipe |
| Motif d'absence | **N+1 voit tout** (codes « Mal », etc.). Seuls les collègues voient juste « absent » |
| Accès inter-services | Un N+1 peut recevoir un **droit d'accès à un autre service** (lecture et/ou validation), accordé par admin/direction |
| Pause midi | **Déduite automatiquement, 30 min, jamais pointée** (comme Dinclock). Si quelqu'un pointe quand même une sortie à midi, pas de double déduction. Seuil (6h) à confirmer |
| Défaut des règles | Si non précisé : **reprendre le paramétrage Dinclock du CFB** |
| Oubli de pointage | Correction par l'employé **auto-validée**, le N+1 peut revenir dessus (question, annulation) |
| Heures sup | **Politique : pas d'heures sup.** Exceptions validées **manuellement** |
| Solde négatif | Autorisé (comme Dinclock), avec alerte — paramétrable par compteur |
| Congés temps partiel | Calcul **automatique au prorata** du régime, RH valide en 1 clic |
| Rappels | **Notifications push** en priorité, e-mail en secours |
| Hébergement | Pas d'abonnement Azure au CFB → front sur Cloudflare Pages (gratuit) |
| Admin général | Rôle `admin` (IT) : **tous les droits** — voir, valider, corriger, clôturer, rapports, paramètres |
| Gestion (02/11/2026) | **Direction = mêmes droits que l'admin RH** (suivi RH, personnes, rapports, réglages). La RH crée et modifie les fiches, sauf admin RH / admin général. Personne ne change son propre rôle |
| Adresses e-mail (04/11/2026) | Domaines du CFB : **centrefamilial.be** et **ceforbxl.be** (avertissement si autre domaine, rien de bloqué) |

## Conventions techniques
- **Fuseau** : toute migration qui crée ou recrée une fonction se termine par `select pointage.fixer_fuseau();`
  (calcul en Europe/Brussels quel que soit le serveur ; un test le vérifie). Dans les vues : `pointage.aujourdhui()`,
  jamais `current_date`.
- Parité local / Supabase : comparer l'empreinte des fonctions après chaque déploiement.

## Stack
- **Simple à maintenir** : l'IT = 1 personne aujourd'hui, successeur inconnu, gestion à distance possible.
- Intégrations Microsoft (Outlook, Teams) : optionnelles, pas au MVP.
