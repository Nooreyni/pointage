# Fonctionnalités « intelligentes » — proposition (31/10/2026)

Objectif : moins d'oublis de pointage, zéro appel de fin de mois par la RH, moins de saisies manuelles.

## 1. Ne pas oublier de pointer
| # | Déclencheur | Action |
|---|---|---|
| 1 | Pas d'entrée à l'heure habituelle + 30 min, aucune absence prévue | Push « Tu as oublié de pointer ? » → **[Pointer maintenant]** ou **[J'étais là depuis 08:05]** (heure habituelle proposée) |
| 2 | Toujours « présent » à l'heure de fin théorique + 1 h | Push « Tu as fini ta journée ? » → **[Pointer ma sortie]** |
| 3 | Sortie manquante la veille | Carte en haut de l'accueil : « Hier : sortie manquante → [16:35 ?] » (1 tap, auto-validé, N+1 informé) |
| 4 | Ouverture de l'app sur le réseau CFB le matin sans entrée | Bouton « Pointer l'entrée » mis en avant |
| 5 | Raccourci sur l'icône de l'app (appui long) | « Pointer » sans ouvrir l'app |

Heures « habituelles » = médiane des 20 derniers jours travaillés (pas de règle à saisir).

## 2. Fin de mois sans relance manuelle
| Moment | Qui | Quoi |
|---|---|---|
| Chaque lundi | Employé | Récap : anomalies ouvertes, solde boni, demandes en cours |
| J-5 fin de mois | Employé avec anomalie | Push + e-mail, lien direct « Corriger » |
| J-2 | N+1 | Liste des personnes de l'équipe encore en anomalie |
| J0 | RH | Tableau « prêt à clôturer » : 0 anomalie restante → bouton Clôturer + export |

## 3. Demandes qui ne traînent pas
- Demande en attente > 3 jours ouvrés → relance du N+1.
- N+1 absent (congé accordé) → la demande remonte **automatiquement à la direction**.
- > 7 jours → la direction est prévenue (filtrable dans ses préférences).
- Validation **en lot** + depuis la notification.

## 4. Garde-fous temps de travail (paramètres du règlement de travail)
- Alerte si la journée dépasse le maximum légal en horaire flottant, ou la semaine le maximum hebdo.
- Alerte quand le boni approche le plafond reportable avant la fin de la période de référence.
- Au-delà : « heures à valider » (pas d'heures sup par défaut), décision manuelle N+1/RH.

## 5. Calculs automatiques
- Pause midi déduite automatiquement (paramètre).
- Congés annuels des temps partiels proposés au prorata du régime au 1er janvier ; la RH valide en 1 clic.
- Report et expiration des compteurs automatiques (plus de corrections « Initialisation… »).

## Canaux de notification
| Canal | Fiabilité | Remarque |
|---|---|---|
| Push PWA Android / PC | Bonne | Natif navigateur |
| Push PWA iPhone | Moyenne | Seulement si l'app est **ajoutée à l'écran d'accueil** (iOS ≥ 16.4) ; bugs de fiabilité signalés en 2026 |
| E-mail (M365 du CFB) | Bonne | Secours systématique pour les rappels importants |
| Teams | — | Plus tard (optionnel) |
