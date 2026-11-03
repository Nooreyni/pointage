# Audit fonctionnel — CFB Pointage (2 novembre 2026)

Point de vue : direction, RH, chef de service, employé, administrateur. Comparé aux fonctions courantes des outils
du marché (Dinclock, SD Worx, Lucca, Factorial, Kelio, Personio : pointage, absences, compteurs, validation,
exports paie, libre-service, contrôle des anomalies).

Légende : ✅ en place · 🆕 ajouté le 02/11 · ❓ décision du CFB · ⛔ hors périmètre (décidé)

## 1. Temps de travail
| Besoin | État |
|---|---|
| Pointage 1 clic, mobile et PC, hors ligne (synchro avec l'heure réelle) | ✅ |
| Type de prestation (bureau, télétravail, mission…) ; détection réseau CFB | ✅ |
| Télétravail habituel par personne, automatique ; changement → N+1 prévenu | ✅ |
| Oubli de pointage : correction auto-validée, N+1 informé | ✅ |
| Pause de midi déduite, seuils, maximum jour / semaine, boni par période | ✅ réglables |
| Régimes, temps partiels, jours au choix (4/5, 3/5, jour libre variable) | ✅ 🆕 |
| Changement de régime daté (crédit-temps, congé parental à temps partiel…) | ✅ |
| Heures au-delà du maximum : politique « pas d'heures sup », exceptions validées | ✅ |
| Jours fériés (et récupérables) | ✅ |
| Pointage sur un poste partagé (tablette à l'entrée) | plus tard (décision 02/11) |
| Planning / horaires d'équipe | ⛔ |

## 2. Absences et compteurs
| Besoin | État |
|---|---|
| Demande (jours, ½ jour, heures), simulation du décompte, conflits d'équipe | ✅ |
| Validation N+1 définitive, direction si chef absent, délégation par service | ✅ |
| Soldes par compteur, prorata temps partiel, attribution annuelle en 1 clic | ✅ |
| Report / expiration en fin de période (perdu, total, plafonné) à la clôture | ✅ réglable |
| Ajustement manuel motivé + historique (qui, quand, pourquoi) | 🆕 |
| Absences encodées par la RH (maladie, petit chômage…) | ✅ |
| Justificatifs | ✅ option, coupée par défaut 🆕 |
| Calendrier d'équipe, agenda personnel (mois / à venir) | ✅ |
| Congés dans Outlook (lien d'agenda personnel) | 🆕 |

## 3. Personnes et comptes
| Besoin | État |
|---|---|
| Création, rôles, service, chef, accès délégués | ✅ · la RH crée et modifie les fiches 🆕 (sans toucher aux admins) |
| Import en masse (reprise Dinclock) avec vérification | 🆕 |
| Arrivée : étapes (régime, compte, congés au prorata, télétravail) | 🆕 |
| Départ : date, impact (soldes, demandes, chef à remplacer), réversible ; accès coupé automatiquement | 🆕 |
| Suppression : jamais ; anonymisation des personnes parties après N ans (5 par défaut, réglable) | 🆕 |
| Connexion : e-mail + mot de passe, Microsoft ; mot de passe généré par la RH ; changement libre | ✅ |
| Double authentification pour admin / RH | 🆕 option, coupée |
| Déconnexion après inactivité (poste partagé) | ✅ réglable |

## 4. Pilotage
| Besoin | État |
|---|---|
| Accueil « À traiter » par rôle (valider, rappeler, régulariser, clôturer) | ✅ |
| Présence du jour (équipe, CFB), rappel de pointage | ✅ |
| Récap du mois par personne, tableau de bord direction, tendances | ✅ |
| Rapport télétravail + indemnité (réglable) ; rapport CPAS (ISP) | ✅ |
| Exports Excel / CSV / XML | ✅ 🆕 |
| Clôture mensuelle avec contrôles | ✅ |
| Fichier au format Partena | ❓ format à obtenir du secrétariat social |
| Paie, fiches de paie, notes de frais, biométrie | ⛔ |

## 5. Administration, sécurité, conformité
| Besoin | État |
|---|---|
| Réglages par thème, fonctions activables, valeurs « à confirmer » | ✅ 🆕 |
| Journal des modifications lisible (append-only) | 🆕 |
| Droits minimaux, RLS, adresse IP (pas de géolocalisation) | ✅ |
| Conservation : IP, pointages (réglable) | ✅ réglage à décider |
| Notifications push + e-mail de secours, relances automatiques | ✅ |
| Sauvegardes (plan Supabase Pro) / export complet des données | ❓ |
| Aide intégrée par rôle, recherche globale | 🆕 / ✅ |
| Accessibilité WCAG A/AA | ✅ contrôlée |

## Décisions à prendre par le CFB
1. Format du fichier Partena.
2. Montant et mode de l'indemnité de télétravail (provisoire : 25 € HT par jour).
3. Sauvegardes : plan Supabase Pro.
4. Anonymisation : le journal d'audit garde les noms (append-only, traçabilité) ; à valider avec le juriste.

Décidé le 02/11 : anonymisation 5 ans (réglable) · tablette plus tard · double authentification en option · Outlook oui.

## Retours mobile du 02/11 (corrigés)
| Retour | Correction |
|---|---|
| Fiche personne brouillon, titres en double | Une seule fiche (Gestion › Personnes), en onglets : Identité · Horaire · Compte · Soldes · Départ |
| Champs qui se chevauchent, mal délimités | Bordures plus nettes, colonnes qui passent à la ligne, dates alignées à gauche |
| Après création, on sort de la fiche | La fiche reste ouverte sur « Compte », étapes « Arrivée » cliquables |
| Étapes « Arrivée » illisibles (lettres empilées) | Corrigé (style des pastilles appliqué au mauvais élément) |
| Direction : réglage des services affiché en premier | Une ligne discrète sous les demandes + « Modifier » |
| RH ne peut pas créer de profil | Possible (Gestion › Personnes) ; garde-fou : pas d'admin RH / admin général |
| Noms et fonctions cités non cliquables | Noms → fiche RH ou fiche de temps ; « Réglages › … » → la bonne section |

Trouvé en plus : mots coupés dans les tableaux sur mobile (Services), alertes tassées, tableau vide en début de mois,
e-mail en double à la création, homonyme signalé, adresse proposée (prénom.nom@domaine du CFB), lien « Fiche RH » depuis
une fiche de temps, chefs cliquables dans Services, personne qui change son propre rôle (bloqué), filtres
En poste / Sans compte / Départ prévu / Parties.

## Retours du 03/11
- Toutes les fenêtres : bouton ✕ (et Échap) ; fiche : bouton « Fermer », « Enregistrer » actif seulement après une modification.
- Direction : Gestion complète (Suivi RH, Personnes, Rapports, Réglages), comme l'admin RH ; double authentification (option) incluse.
- RH : encart « Ce mois-ci » dans Suivi RH (absence, maladie, télétravail, demandes en attente, service le plus absent) → lien vers Rapports.
- ISP : plus de service « ES / ISP » dans la démo (c'était un groupe de filtre de Dinclock) ; chaque ISP est rattaché à son service.
- Congés (PC) : deux rangées équilibrées (prochains congés | soldes, nouvelle demande | mes demandes), cartes de même hauteur.
- Demandes à valider : « Ouvrir » → fiche (période, décompte, message, justificatif, solde avant / après, collègues du service
  absents ces jours-là), Accepter / Refuser (motif) / Fermer, passage à la demande suivante.

## Ajouts du 03/11 (suite du dernier tour)
- Aide : bouton « ? » par écran, page Aide avec recherche, carte de bienvenue (une seule source, adaptée au rôle).
- Équipe : badge ISP et filtre ISP transversal (ouvert d'office pour la responsable ISP).
- Accès à un autre service avec date de fin (remplacement pendant un congé), personne prévenue, expiré = sans effet.
- Congés › À valider : « Décidées récemment » (60 jours ; pour la gestion : ses propres décisions).
- Mon mois : message clair en début de mois ; calendrier mobile : barres de couleur au lieu de libellés tronqués.
- Tests de bout en bout dans le dépôt (`npm run e2e`) et sur GitHub à chaque envoi.
