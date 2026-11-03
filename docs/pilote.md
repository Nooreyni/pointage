# Pilote — CFB Pointage

Objectif : prouver, sur un vrai mois, que l'outil donne **les mêmes résultats que Dinclock** (ou des écarts expliqués) et
qu'il est utilisable sans aide, avant de l'étendre à tout le CFB. Décisions : la direction, sur proposition de l'IT.

## 1. Périmètre proposé (à valider)

| Élément | Proposition |
|---|---|
| Durée | 4 à 6 semaines, couvrant **une clôture de mois complète** |
| Participants | 1 service avec son chef (idéalement un service avec un temps partiel et un ISP), la RH, la direction |
| Fonctionnement | **En double** : Dinclock reste la référence pendant le pilote ; on pointe dans les deux |
| Hors pilote | Fichier Partena (format à obtenir), pointage sur tablette |

## 2. Avant de démarrer (cocher)

- [ ] Projet Supabase de production créé, `scripts/mise-en-production.sh` passé, `verifier-installation.sql` sans ❌ bloquant
- [ ] Réglages Supabase faits : inscriptions libres coupées, mot de passe ≥ 8, protection mots de passe compromis, Microsoft
- [ ] Domaine `pointage.<domaine>` en place ; appli installée sur 2 ou 3 téléphones de test (Android + iPhone)
- [ ] Personnes du pilote importées (Gestion › Personnes › Importer, CSV depuis Dinclock) et **soldes repris** au jour J
- [ ] Comptes créés (mot de passe remis en main propre) ; notifications activées sur chaque appareil
- [ ] RH a passé en revue les valeurs « À confirmer » (§5) ; celles qui ne sont pas encore tranchées sont notées
- [ ] Information des participants (but du pilote, données collectées : heures, absences, adresse IP — pas de géolocalisation)
- [ ] Avis juridique / secrétariat social sollicité sur : information du personnel, règlement de travail, conservation des IP

## 3. Pendant le pilote

| Quand | Qui | Quoi |
|---|---|---|
| Chaque jour | Participants | Pointer dans les deux outils |
| Chaque semaine | IT | 15 min de retours (formulaire ou réunion) ; corrections priorisées : bloquant > gênant > confort |
| Chaque semaine | RH | Comparer pour 3 personnes : heures prestées, boni, absences (Mon mois › Heures vs Dinclock) |
| Fin de mois | RH + IT | **Clôture en double** : comparer, pour chaque participant, heures, boni, soldes de congés, jours à régulariser |

Noter chaque écart : personne, jour, valeur Dinclock, valeur CFB Pointage, explication (règle différente, erreur de pointage,
anomalie de l'outil).

## 4. Critères pour étendre à tout le CFB (go / no-go)

- [ ] Clôture du mois : **0 écart inexpliqué** sur les heures, le boni et les soldes
- [ ] Aucun incident bloquant (impossible de pointer, de valider, données perdues) pendant les 2 dernières semaines
- [ ] Toutes les valeurs « À confirmer » tranchées par la RH (ou acceptées telles quelles, par écrit)
- [ ] Participants : capables de pointer, demander un congé et valider sans aide (l'aide intégrée suffit)
- [ ] Sauvegardes actives et restauration testée une fois (sur un projet de test)
- [ ] Avis juridique reçu et suites données

Si un critère n'est pas rempli : prolonger le pilote de 2 à 4 semaines plutôt qu'étendre.

## 5. Valeurs à confirmer par la RH (état au 03/11/2026)

Liste à jour à tout moment : Réglages › Paramètres (badge « À confirmer »), ou
`select categorie, libelle, valeur, unite, source from pointage.parametres where provisoire order by categorie;`

| Thème | Réglage | Valeur proposée |
|---|---|---|
| Temps de travail | Pause de midi déduite | 30 min, si la journée dépasse 6 h |
| Temps de travail | Période de référence du boni | 3 mois |
| Temps de travail | Boni reportable | + 12 h / − 12 h |
| Temps de travail | Maximum journalier / hebdomadaire (horaire flottant) | 9 h / 45 h |
| Temps de travail | Jour non prévu travaillé (week-end, férié) | à valider par le N+1 plutôt qu'en boni |
| Temps de travail | Pointage hors ligne accepté jusqu'à | 72 h |
| Temps de travail | Double appui refusé | désactivé (0 s) |
| Congés | Congés annuels | 4 semaines du régime, au prorata |
| Congés | Compteurs (report en fin de période) | règles provisoires sur les 9 compteurs |
| Congés | Justificatifs | non demandés ; si activés, visibles par la RH seulement |
| Télétravail | Indemnité | 25 € HT par jour, sans plafond |
| Rappels | Entrée / sortie oubliée, fin de mois, demandes en attente | délais proposés (30 min, 60 min, J-5, J-2, 3 jours) |
| Sécurité | Déconnexion après inactivité | désactivée (à régler si des PC sont partagés) |
| Confidentialité | Regroupement des petits services dans les stats | moins de 3 personnes |
| Conservation | Anonymisation des personnes parties | 5 ans (décision du 02/11, à confirmer) |
| Conservation | Suppression des pointages anciens | jamais (à décider) |
