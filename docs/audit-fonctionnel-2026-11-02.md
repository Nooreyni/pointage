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
| Pointage sur un poste partagé (tablette à l'entrée) | ❓ |
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
| Congés dans Outlook (lien calendrier) | ❓ |

## 3. Personnes et comptes
| Besoin | État |
|---|---|
| Création, rôles, service, chef, accès délégués | ✅ |
| Import en masse (reprise Dinclock) avec vérification | 🆕 |
| Arrivée : étapes (régime, compte, congés au prorata, télétravail) | 🆕 |
| Départ : date, impact (soldes, demandes, chef à remplacer), réversible ; accès coupé automatiquement | 🆕 |
| Suppression : jamais (historique conservé) ; effacement / anonymisation après X ans | ❓ légal |
| Connexion : e-mail + mot de passe, Microsoft ; mot de passe généré par la RH ; changement libre | ✅ |
| Double authentification pour admin / RH | ❓ |
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
1. Effacement / anonymisation des personnes parties : délai (question légale).
2. Pointage sur un poste partagé à l'entrée : oui / non.
3. Double authentification pour admin / RH.
4. Congés visibles dans Outlook.
5. Format du fichier Partena.
6. Montant et mode de l'indemnité de télétravail (provisoire : 25 € HT par jour).
7. Sauvegardes : plan Supabase Pro.
