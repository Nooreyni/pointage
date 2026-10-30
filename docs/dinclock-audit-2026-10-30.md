# Audit fonctionnel DinClock — CFB (en vue du remplacement)

- **Date** : 30/10/2026, exploration en **lecture seule** (aucune validation, aucun enregistrement, aucun pointage)
- **Compte utilisé** : O.D. (N°7060), vues **Privé** et **N+1**
- **Instance** : dinclock.com/centrefamilial — « Présenté par MPTS »
- **Licence** : `68/100 [utilisés/licence]`
- **Noms des collègues** remplacés par leurs initiales

---

## 1. Menus

### Vue N+1 (ancienne interface, frameset JSP)

| Menu | Sous-menu | Écran / page | Accès |
|---|---|---|---|
| **Personnel** | Liste | `listemployees.jsp` : recherche A–Z, tri (Nom / Prénom / N° travailleur), groupé par (Catégorie de pointage / Service / Contrat), case « Afficher le personnel archivé » | ✅ |
| | Planning | 3 onglets : **Planning** (éditable), **Planning N+1** (lecture + Imprimer), **Planning Public** (éditable) | ✅ |
| | Sélection | `selectemployees.jsp` : listes non sélectionnés / sélectionnés, tri, groupé par, « Focus sur / Inversion du focus », « Advanced… » | ✅ |
| | Présences | `categorypresence.jsp` : présences en temps réel par groupe (Contrat:ISP, Temps partiel, Temps plein) + organigramme | ✅ |
| | Entitlement (libellé changeant : « Enrôlement ») | — | ❌ « L'accès à cette page a été refusé » |
| **[Employé sélectionné]** (moi ou un membre de l'équipe) | Agenda | Agenda annuel avec codes jour + options « Afficher le compteur » / « Calendrier compagnie » | ✅ |
| | Fiche | Onglet « Général » uniquement | ✅ |
| | État | État journalier (compteurs, soldes, anomalies, pointages) | ✅ |
| | Demandes | Nouvelle demande + historique | ✅ |
| **Rapports** | — | 5 rapports (voir §9) | ✅ |
| **Demandes** | — | Demandes de l'équipe à traiter (filtre groupe ES/ISP) | ✅ |
| En-tête | Sélecteur d'employé ◀ ▶ | Bascule le menu « Employé » sur un membre de l'équipe | ✅ |
| | Sélecteur de vue | `N+1` / `Privé` | ✅ |
| | `?` | Aide en ligne (non ouverte) | — |
| | Nom (en haut à droite) | `changelogin.jsp` (profil / mot de passe) | ✅ |

### Vue Privé (nouvelle interface, responsive + menu hamburger)

| Menu | Contenu |
|---|---|
| État | Identique à l'État N+1, mais présentation plus récente |
| Pointeuse | 8 boutons de pointage + commentaire (voir §5) |
| Agenda | Agenda annuel + Options |
| Demandes | Nouvelle demande (4 types) + « Status des demandes » (filtre État) |
| Icône profil | Maintien de connexion, langue, nom d'utilisateur (= e-mail), changement de mot de passe |
| Icônes `?` / ⏻ | Aide / déconnexion |

> ⚠️ Il y a **deux interfaces différentes** : l'ancienne (N+1, frames) et une plus récente (Privé).

---

## 2. Régimes de travail / horaires

DinClock ne gère pas de « régime hebdomadaire » visible en tant que tel. Il fonctionne avec des **journées types** affectées jour par jour (via le planning), et chaque journée type porte une durée théorique.

### Journées de travail ordinaires (durée théorique)

| Journée type | Durée |
|---|---|
| Horaire journalier 3H30 / 4h / 4h30 / 4h42 / 5h / 5h30 / 6h / 6h30 / 7h / 7h30 / **7h36** / 7h45 / 8h / 8h30 | durée = libellé |
| Jour forfaitaire 7h36 | 7h36 |
| Crédit temps demi-journée | 7h36 |
| Crédit temps parental | 7h36 |
| **Journées mixtes** (prestation + RTT / MTM / maladie / crédit temps / congé parental) — ~45 combinaisons | ex. : `0h45 RTT` → 7h15 · `2+2H RTT` → 2h00 · `3.48+3.48 MTM` → 7h36 · `3h+4h maladie` → 7h00 · `4h+3.36 cpar` → 7h36 · `6H+2H Credit Temps` → 8h00 · `6h36+1 CPAR` → 7h36 · `8H30+0H30 RTT` → 8h30 … |

### Week-end / repos

| Type | Durée |
|---|---|
| Week-end, Jour de repos, Crédit temps partiel | — |
| Congé parental | 7h36 |
| Crédit temps fin de carrière 5.15 / 7 | 5h15 / 7h00 |

### Temps partiels observés dans le planning (octobre 2026)

| Profil | Motif hebdo observé |
|---|---|
| Temps plein 38h | 7h36 × 5 |
| Temps plein 37h30 | 7h30 × 5 (cas le plus fréquent, ISP) |
| Temps partiel « 4/5 » mixte | 8h00 × 4 + 4h00 le mercredi |
| Variable | 8h00 / 5h30 / 8h00 / 8h00 / 5h30 |
| Variable | 6h00 / 8h00 en alternance |

- **Effectif tot.** affiche 16 ou **15,5** (un mi-temps compté 0,5 certains jours) ; **Effectif disp.** = présents planifiés.
- **Plages fixes / flexible** : aucune plage horaire (heure de début/fin, plages fixes) n'est visible. Le système fonctionne en **horaire flexible** sur la durée journalière, avec un **boni** (voir §3).

---

## 3. Calcul du temps

| Règle | Ce qui est visible | Valeur exacte |
|---|---|---|
| Pause de midi | Pas de pointage de pause dans les relevés (ex. 07:56 → 16:30 sur une journée de 8h00). Ex. perso : 08:00 → 16:08 (8h08) = 7h36 prestées légales + 0h01 boni → **pause probablement déduite automatiquement (~30 min)** | à confirmer (non affiché) |
| Arrondis / tolérances | Non affichés | ? |
| **Boni (heures flexibles)** | Visible dans « Détails » des compteurs | **journalier max 15h00 · mensuel max 100h00 · mensuel min −15h00** |
| Boni du jour | Compteur journalier | ex. 0h01 |
| Heures sup | Compteurs « Heures supp à valider », « Heures sup non approuvées » (HSNA), « Total trimestriel des HS validées » | les HS ne sont pas créditées tant qu'elles ne sont pas validées |
| Validation HS | Via des corrections de compteur : « Validation des heures supplémentaires (heures) » / « Refus des heures supplémentaires (heures) » | manuel, par l'admin |
| Récup HS | Solde « Récup HS (Trimestrielle) » | période **trimestrielle** |
| Repos compensatoire | Solde « Repos Compensatoire (trimestriel) » | ex. 45h24 attribués |
| Clôture | Message : « Les soldes de clôture affichés ne sont plus valables depuis le **21/08/26** » + colonne « (*) Clôture de la veille » | clôture visiblement non relancée depuis 2 mois |
| Congés annuels | Tous à **152h00** (= 20 j × 7h36) | comptés en **heures**, montant identique pour tous |

---

## 4. Compteurs

> ⚠️ Les **codes**, l'**unité configurée**, la **période**, le **report**, l'**expiration** et le statut actif/historique **ne sont pas visibles** avec ce rôle. La liste vient du sélecteur « Afficher le compteur » de l'agenda. Seul un code est apparu : `[00208]` devant Télétravail.

### 4a. Compteurs journaliers (prestations / absences)

| Libellé | Remarque |
|---|---|
| Heures prestées légales · Heures totales prestées · Boni du jour · Heures à justifier · Heures manquantes · Heures neutralisées | prestation |
| Heures sup non approuvées · Heures supplémentaires à valider · Ajouté au Boni / Enlevé au Boni – heures flexibles | HS / boni |
| Télétravail · Visite · Mission · Formation · Mandat · Permanence VAD · Jour communautaire · Jour de sollicitation | présence hors site |
| Absence injustifiée · Absence justifiée · Accident de travail · Grève · Petits chômages | absences |
| Maladie · Maladie 3J sans certificat · Maladie + de 30 J · Maladie + de 300 J | maladie |
| Congé annuel · Congé annuel (année passée) · Congé annuel (année −2) · Congé ancienneté · Congé extra-légal · Congé vacances jeunes · Congé éducation · Congé parental · Congé sans solde · Congé de maternité · Congé de naissance +3J · Congé fam. raisons impérieuses · Crédit temps fin de carrière · Crédit temps partiel | congés |
| Jour de fête rémunéré · Récupération Jour Férié · Récup · Récupération Année 2023 · Repos compensatoire · RTT | récup / fériés |

### 4b. Corrections manuelles (mouvements de compteur, en heures)

Ajout de boni ou heures flexibles · Ajout d'heures de travail · Ajout d'heures supplémentaires · Ajout de jours de fête récupérables · Ajout de repos compensatoire · Congé annuel (heures) · Congé annuel année −2 / année passée (heures) · Congé parental (heures) · Congé éducation (heures) · Congés vacances jeunes (heures) · Crédit temps partiel (heures) · Formation (heures) · Formation Synd (heures) · **Initialisation** des congés de l'année −2 / de l'année passée / des récup 2023 (heures) · Interruption de la journée pour maladie / pour accident de travail (heures) · Maladie + 30 J / + 300 J (heures) · Mission syndicale (heures) · Refus des heures supplémentaires (heures) · Reprise d'heures de fête récupérables · Reprise de boni · Reprise de congés d'ancienneté / extra-légaux (heures) · Récup (heures) · Récup 2023 (heures) · Validation des heures supplémentaires (heures)

→ Le **report annuel** se fait visiblement par des corrections « Initialisation… » manuelles : il n'y a pas de report automatique visible.

### 4c. Soldes (visibles dans l'État)

| Solde | Période (d'après le libellé) | Visible employé |
|---|---|---|
| Boni | continue (limites §3) | ✅ |
| Récup HS | trimestrielle | ✅ |
| Heures supp à valider | continue | ✅ |
| Total trimestriel des HS validées | trimestre | ✅ |
| Repos compensatoire | trimestriel | ✅ |
| Total mensuel heures prestées | mois | N+1 (ISP) |
| Total mensuel heures à justifier | mois | N+1 (ISP) |
| Heures de récup 2023 | historique | — |

### 4d. Soldes congés (Attribués / Pris / Reste)

| Solde | Exemple (perso) |
|---|---|
| Congés annuels | 152h00 / 91h12 / 60h48 |
| Congés année passée | (ISP) 144h30 / 0h00 / 144h30 |
| Récup HS (Trimestrielle) | 3h40 / 0h00 / 3h40 — **négatif possible** (−22h30 observé) |
| Congés extra-légaux | 30h24 / 0h00 / 30h24 |
| Repos Compensatoire (trimestriel) | 45h24 / 0h00 / 45h24 |

---

## 5. Pointeuse

| Élément | Détail |
|---|---|
| Types (8) | **Entrée · Sortie · 1. TT · 2. Visite · 3. Mission · 4. Formation · 5. Mandat · 6. VAD Permanence** |
| Champs | Horloge serveur (affichée en direct) + 1 champ **commentaire** + bouton « Valider » |
| Données envoyées (code JS `punch()`) | `eventType`, `comment`, `timeZone` (POST `ws/punch`) |
| Données enregistrées (visibles dans l'État) | date/heure, type, **2 adresses IP** (ex. IP publique + IP relais/proxy) |
| Géolocalisation / appareil / réseau | ❌ aucune géoloc, aucune empreinte appareil visible |
| Règles affichées | aucune (pas de restriction de réseau ni de plage horaire visible) |
| Pointage a posteriori | Demande « Création de pointage » : **traitée automatiquement**, avec e-mail à l'administration (voir §6) |
| Remarque du jour | Champ « Remarques » + « Valider » sur l'État (texte libre) |

---

## 6. Demandes

### Types et formulaires

| Type | Champs | Codes proposés |
|---|---|---|
| **Jour(s) de congé** (`form1`) | Période (Du…au / Le), Type, Introduit le (auto), Commentaire, « à traiter par », tableau des soldes | Congé année −2 · Congé année −1 · Récupération jour communautaire · Récup 2023 · Récup · Jour de congé extra-légal · Congé vacances jeunes · **Congé payés** (défaut) · Congé ancienneté |
| **1/2 jour de congé** (`form2`) | Période (Le / Du), Type, Commentaire, soldes | 1/2 – Congé annuel année −2 · 1/2 – Congé annuel année passée · 1/2 – Jour d'ancienneté · 1/2 – Jour de congé extra-légal · 1/2 – Jour de récup 2023 · **1/2 – Récup** (défaut) |
| **Heures de congé** (`form3`) | Période, Type, **Durée** (0–23 h + 00–59 min), Commentaire, soldes | Récup (Heures) · Récup 2023 (heures) · Reprise de congés d'ancienneté (heures) · Reprise de congés extra-légaux (heures) · RTT (heures) |
| **Création de pointage** (`form4`) | Le (date), à (heure : liste 07:00…23:00 + saisie), Action (8 types de la pointeuse), Commentaire | — « Cette demande est traitée automatiquement. Un e-mail de notification est envoyé à l'administration si la demande est bien validée. » |

### Règles constatées

| Règle | Constat |
|---|---|
| ½ jour | Type dédié, mais **pas de « 1/2 congé annuel de l'année en cours »** (seulement −2 / année passée) |
| Heures | Oui (form3), à la minute près |
| Solde négatif | **Autorisé** de fait (Récup HS à −22h30 chez un ISP) |
| Justificatif | ❌ aucun champ pièce jointe (même pour la maladie : pas de demande maladie côté employé) |
| Rétroactivité | Possible (demande introduite le 06/01 pour le 26/12) |
| Annulation | Bouton « Annuler cette demande » côté demandeur **et côté N+1** |
| Modification | « Envoyer la modification » (désactivé une fois la demande décidée) |
| Codes agenda | VA (Congé payés), JF, Mal, RECUP, WE, T (télétravail, petit marqueur), FAM, Mal 2J… |

---

## 7. Circuit de validation

| Élément | Constat |
|---|---|
| Statuts vus | **Nouveau** · **Accordé** · **Annulé** (filtres : « À traiter à mon niveau », « En cours », « Clôturé », « Tout ») |
| Bloc Décision | Décision + **nom du décideur** + date/heure (ex. accordé par A.S. le 16/02 pour une demande du 06/01) |
| Qui valide quoi | Ma vue N+1 couvre le groupe **ES/ISP** (16 personnes). Mes propres demandes sont validées par quelqu'un d'autre (non identifiable depuis mon compte) |
| Délais | Ma demande RECUP du 21–23/10, introduite le **30/09**, est toujours « Nouveau » → **> 1 mois sans traitement** ; ces jours apparaissent comme anomalies « Absent… » |
| Délégation | ❌ aucune option visible |
| Notifications | Seulement mentionnées pour la « Création de pointage » (e-mail admin) |
| Cas des ISP | 14 ISP (Art. 60) + 2 « Non défini » dans le groupe ES/ISP ; leurs demandes sont décidées par A.S. ; le N+1 voit leurs soldes mensuels « heures à justifier / prestées » (suivi CPAS) |

---

## 8. Anomalies

| Anomalie (libellé exact) | Couleur | Bloquante ? | Occurrences (ES/ISP, oct. 2026) |
|---|---|---|---|
| `Absent...` | rouge | **Oui** (bandeau « anomalies antérieures de niveau bloquant ») | 52 |
| `Problème : nombre de pointages impair...` | rouge | Oui | 1 |
| `Présence en début de Plage de clôture` (23:59) | rouge | Oui | 1 |
| `Entrée enregistré plus d'une fois` | violet | Non (information) | 1 |

- **Affichage** : case rouge dans l'agenda + bandeau jaune sur l'État.
- **Correction côté employé** : demande « Création de pointage » ou demande de congé (l'anomalie « Absent » disparaît quand la demande est accordée).
- **Correction côté N+1 / admin** (vu dans le code, non cliqué) : `correctevent.jsp` (ajout/modif de pointage, bouton « + »), « Correction Horaire » (compteurs), « Changer » journée type, « Note », remarque.

---

## 9. Rapports / exports

| Rapport | Description | Filtres | Colonnes / contenu |
|---|---|---|---|
| Anomalies/Informations | Rapport des anomalies | Période (1 jour / 1 semaine / 1 mois / 1 an / Autre), Groupes, Organigramme (groupé par) | Employee · Anomaly · Date · (heure) |
| Pointages & compteurs | Nombre d'heures sup non approuvées | Période (défaut glissant **19/10 → 18/11**), Organigramme | Date · code jour · Pointages · **HSNA** · « Total période » (marqué « non valable » si anomalie) |
| Pointages & compteurs hsna | Pointages + HSNA | idem | Date · horaire théorique · heures d'entrée/sortie · HSNA |
| Soldes congés | Soldes congés | **Date** ponctuelle, Organigramme | par personne : Attribués · Pris · Reste à prendre |
| Statistique par classe | Statistiques Maladie | Période, Classes (Contrat) | heures de maladie par **contrat × jour** + sous-total + total |

- **Boutons communs** : Focus · Actualiser · Modifier… · Imprimer… · Exporter · « Une page par personne ».
- **Format d'export** : **Excel uniquement** (« Télécharger en Excel », non téléchargé). Pas de CSV ni de PDF natif (impression navigateur).

---

## 10. Paramètres RH / admin visibles

| Élément | Valeurs |
|---|---|
| Jours fériés (types) | Jour de fête rémunéré · Jour de fête (non rémunéré) · Jour de fête à récupérer |
| Clôture | Dernière clôture valable : **21/08/26** |
| Rôles | **Privé** (employé) · **N+1** (responsable) ; Entitlement/admin non accessible |
| Services (Fiche) | Logistique · ES/ ISP (organigramme) |
| Contrats | ISP (Art. 60) · Temps partiel · Temps Plein |
| Catégorie de pointage | une seule : « Employés » |
| Fiche employé | Nom, Prénom, N° travailleur, E-mail, Langue (8 langues), Date d'entrée/sortie, Contact d'urgence, Service, Contrat, Date anniversaire |
| Authentification | Login = e-mail + **mot de passe local** (pas de SSO Entra ID visible), option « maintenir ma connexion ouverte » |
| Licence | 68/100 |

---

## 11. Pistes d'amélioration (ce qui est mal fait, confus ou lent)

| # | Problème | Impact | Piste pour la nouvelle app |
|---|---|---|---|
| 1 | **Deux interfaces** (frames JSP + nouvelle UI), libellés EN/FR mélangés (« Employee/Anomaly », « Entitlement/Enrôlement »), fautes (« heures à justifiées », « Entrée enregistré ») | confusion, image vieillissante | une seule PWA responsive, i18n propre |
| 2 | **~45 journées types « mixtes »** (« 3h+4h maladie+1hRTT »…) pour coder des cas particuliers | paramétrage ingérable | régimes hebdo + absences partielles en heures |
| 3 | « Création de pointage » **auto-validée** | fraude / erreurs possibles | validation N+1 obligatoire + motif |
| 4 | Demandes **non traitées > 1 mois**, sans relance ni délégation | anomalies « Absent » qui s'accumulent | SLA, rappels, délégation, file « à traiter » |
| 5 | **Clôture non relancée depuis le 21/08** | soldes non fiables | clôture mensuelle automatique + alerte |
| 6 | Soldes **négatifs** sans garde-fou ; congés « année passée » de 144h30 pour une entrée en 11/2025 | données incohérentes | règles de solde configurables + contrôle à la saisie |
| 7 | Report annuel par corrections manuelles « Initialisation… » ; compteurs historiques (« Récup 2023 ») toujours actifs | dette de paramétrage | report/expiration automatiques, archivage des compteurs |
| 8 | ~95 compteurs dans une seule liste déroulante | illisible | catégorisation + compteurs masqués/archivés |
| 9 | Pas de justificatif joint, pas de demande maladie | flux papier en parallèle | upload certificat (stockage SharePoint, RGPD) |
| 10 | Pas de ½ jour de congé annuel de l'année en cours | contournements (1/2V-2) | ½ j / heures pour tous les types |
| 11 | **Données de santé** (codes « Mal », rapport Statistiques Maladie) visibles par le N+1 | **risque RGPD** (art. 9) | code générique « Absent » pour le N+1, détail réservé aux RH |
| 12 | Pointage : IP seulement, pas de contrôle réseau ni de géoloc | TT vs présentiel invérifiable | règle optionnelle IP/réseau CFB, géoloc opt-in |
| 13 | HSNA sur des **dimanches** (25/10 = passage à l'heure d'hiver, 01/11) | bug potentiel de calcul | tests sur les changements d'heure |
| 14 | Rapports : période par défaut glissante (19/10→18/11), filtre organigramme obligatoire sinon rien ne s'affiche, export Excel seul | lent, peu intuitif | rapports préconfigurés + CSV/Excel/PDF + API |
| 15 | Auth locale, pas de SSO | gestion de mots de passe en plus | SSO Entra ID (M365) |
| 16 | Le N+1 peut annuler les demandes des autres, changer les journées types et corriger des compteurs depuis l'État, avec des boutons/icônes sans libellé | risque d'erreur | actions explicites, confirmation, journal d'audit visible |

---

## Écrans non accessibles / non explorés

| Écran | Raison |
|---|---|
| Personnel › Entitlement / Enrôlement | « L'accès à cette page a été refusé » |
| Paramétrage admin (régimes, définition des compteurs, jours fériés datés, clôture, rôles, groupes) | aucun menu admin pour ce compte |
| Popups d'écriture N+1 : Correction Horaire, « + » Ajouter pointage, « Changer » journée type (seule la liste a été affichée, rien n'a été appliqué), Note, « * » | lecture seule, non cliqués |
| Planning › « Valider… », « Simuler », Journées types, permutations | modification de planning, non cliqués |
| Exporter › Télécharger en Excel | téléchargement non effectué |
| Aide `?` | non ouverte (lien externe) |
| Sélection › Advanced… ; Personnel archivé | non ouverts |

---

## Questions ouvertes

1. Pause de midi : déduction automatique de 30 min ? Seuil de déclenchement (ex. > 6h prestées) ?
2. Arrondis et tolérances d'entrée/sortie : existent-ils ?
3. Qui valide les demandes hors ES/ISP (dont les miennes) ? Y a-t-il plusieurs niveaux de validation ?
4. Pourquoi la clôture est-elle bloquée depuis le 21/08/26 ? Qui la lance ?
5. Les HS « à valider » sont-elles validées un jour ? Par qui, et à quelle fréquence (trimestrielle ?) ?
6. Règles d'expiration des congés « année passée / année −2 » et de « Récup 2023 » ?
7. Les ISP ont-ils une obligation de reporting CPAS (heures prestées/à justifier) qui doit être exportée ?
8. Comment sont gérés les 52 « Absent… » des ISP : vraies absences ou absence de pointage ?
9. HSNA des dimanches 25/10 et 01/11 : bug du changement d'heure ou vraies prestations ?
10. Faut-il reprendre l'historique (soldes, pointages) dans la nouvelle app, ou démarrer avec des soldes initiaux ?
11. Fin du contrat DinClock / MPTS et possibilité d'export complet des données (API, dump) ?
12. Le N+1 doit-il continuer à voir les motifs médicaux (RGPD) ?

---

## Log

```
[2026-10-30] LECTURE - DinClock vues N+1 + Privé (menus, formulaires, 5 rapports) - OK
[2026-10-30] ACCÈS REFUSÉ - Personnel > Entitlement - KO
[2026-10-30] AUCUNE ÉCRITURE - pas de validation, pas de pointage, pas d'envoi, pas de téléchargement - OK
[2026-10-30] VUE - sélecteur repositionné sur N+1 (état initial) - OK
```
