export type Sens = 'entree' | 'sortie'
export type Lieu = 'reseau_cfb' | 'externe' | 'inconnu'

export interface Profil {
  id: string
  prenom: string
  nom: string
  email: string
  role: 'employe' | 'rh' | 'admin_rh' | 'responsable_isp' | 'direction' | 'admin'
  type: 'interne' | 'isp'
  service: string
  regime: string | null
  minutes_jour: number[] | null
  est_chef_service: boolean
  jours_teletravail?: number[]   // 1 = lundi … 7 = dimanche
  heure_arrivee?: number | null  // horaires habituels déclarés (minutes depuis minuit) ; null = appris d'après les pointages
  heure_depart?: number | null
  accueil_fait_le?: string | null // parcours d'accueil terminé (ou passé)
  testeur?: boolean               // teste l'outil avant le pilote : visite guidée + bouton « Mon avis »
}

export interface LigneAdoption {
  personne_id: string; prenom: string; nom: string; service: string; role: string; testeur: boolean
  compte_cree_le: string | null; derniere_connexion: string | null; accueil_fait_le: string | null
  appareils: number; dernier_pointage: string | null; pointages_7j: number; avis: number
}
export interface ComptesService { service_id: string; service: string; sans_compte: number; avec_compte: number }
export type TypeAvis = 'probleme' | 'idee' | 'question' | 'ok' | 'reglage_ok' | 'reglage_changer'
export interface Avis {
  id: number; type: TypeAvis; ecran: string | null; parametre: string | null; message: string | null; cree_le: string; traite_le: string | null
  personne_id?: string; prenom?: string; nom?: string; role?: string; parametre_libelle?: string | null
}
export interface ProblemeSante { code: string; titre: string; detail?: string }
export interface SanteSysteme { ok: boolean; problemes: ProblemeSante[]; avertissements: ProblemeSante[]; derniers_passages: Record<string, string | null>; verifie_le: string }
export type ChampSignale = 'nom' | 'email' | 'service' | 'role' | 'regime' | 'horaire' | 'autre'
export interface Signalement { id: number; champ: ChampSignale; message: string | null; cree_le: string; traite_le?: string | null
  personne_id?: string; prenom?: string; nom?: string; service?: string }

/** Horaires habituels : déclarés (ou null) et ceux réellement utilisés (déclarés, appris ou par défaut). */
export interface Horaire { arrivee: number | null; depart: number | null; utilise_arrivee: number; utilise_depart: number; modifiable: boolean }

export interface Pointage {
  id: string
  horodatage: string
  jour: string
  sens: Sens
  type_code: string
  source: string
  lieu: Lieu
  remarque: string | null
  annule: boolean
  annule_motif: string | null
  cree_le: string
  enAttente?: boolean // pointage hors ligne pas encore synchronisé
  differe?: boolean          // envoyé plus tard que l'heure déclarée (synchro hors ligne)
  differe_min?: number | null
}

export interface Journee {
  jour: string
  prevues: number
  absence: number
  a_prester: number
  nb_pointages: number
  brut: number
  pause_deduite: number
  preste: number
  boni: number
  depassement: number
  complete: boolean
}

export interface Anomalie {
  jour: string
  code: 'absent' | 'pointages_incomplets' | 'semaine_max'
  libelle: string
}

export interface Presence {
  personne_id: string
  prenom: string
  nom: string
  service: string
  mon_service: boolean
  statut: string
  depuis: string | null
}

export interface Notif {
  id: number
  type: string
  titre: string
  corps: string | null
  lien: string | null
  cree_le: string
  lu_le: string | null
}

export interface TypePointage {
  code: string
  libelle: string
  ordre: number
}

export interface DemandePointage {
  client_id: string
  horodatage?: string
  type_code?: string | null
  remarque?: string | null
}

export type TypeDemande = 'conge_jours' | 'conge_demi_jour' | 'conge_heures'
export type StatutDemande = 'en_attente' | 'accordee' | 'refusee' | 'annulee'

export interface Solde {
  compteur_code: string
  libelle: string
  ordre: number
  periode_debut: string
  attribue_min: number
  pris_min: number
  reste_min: number
}

export interface CodeAbsence {
  code: string
  libelle: string
  code_court: string | null
  compteur_code: string | null
  demandable: boolean
  justificatif_requis: boolean
  ordre: number
}

export interface Demande {
  id: string
  numero: number
  personne_id: string
  prenom: string
  nom: string
  type: TypeDemande
  code_absence: string
  libelle_absence: string
  date_debut: string
  date_fin: string
  demi: 'matin' | 'apres_midi' | null
  minutes_decomptees: number
  commentaire: string | null
  statut: StatutDemande
  decide_le: string | null
  decide_par?: string | null
  commentaire_decision: string | null
  constate_le: string | null
  encode_par_rh: boolean
  cree_le: string
  je_peux_valider: boolean
  justificatif_requis?: boolean
  justificatif_joint?: boolean
  justificatif_chemin?: string | null      // présent seulement pour qui peut l'ouvrir
}

export interface SaisieDemande {
  type: TypeDemande
  code_absence: string
  debut: string
  fin: string
  demi: 'matin' | 'apres_midi' | null
  minutes: number | null
  commentaire?: string | null
}

export interface Simulation {
  minutes: number
  compteur: string | null
  solde_avant: number | null
  solde_apres: number | null
  solde_negatif: boolean
  collegues_absents: number
  effectif_service: number
  seuil_depasse: boolean
}

export interface Personne {
  id: string
  prenom: string
  nom: string
  service: string
  type: 'interne' | 'isp'
  role: Profil['role']
}

export interface AnomalieRH extends Anomalie { personne_id: string }

export interface PropositionConges {
  personne_id: string
  prenom: string
  nom: string
  regime: string
  mois_presence: number
  minutes: number
}

export interface EtatCloture {
  mois: string
  deja_cloture: boolean
  derniere_cloture: string | null
  mois_termine: boolean
  anomalies: { personne_id: string; prenom: string; nom: string; jours: number }[]
  demandes_en_attente: number
  conges_a_constater: number
}

export interface HeureAValider { personne_id: string; prenom: string; nom: string; jour: string; minutes: number }

export interface StatService {
  service: string
  effectif: number
  prevues: number
  preste: number
  absence_conge: number
  absence_maladie: number | null
  absence_autre: number
  regroupe?: boolean
  jours_presence: number
  jours_tt: number
  anomalies: number
}

export interface StatsDirection {
  debut: string
  fin: string
  services: StatService[]
  seuil_anonymat?: number
  tendance: { mois: string; taux_absence: number | null; taux_tt: number | null }[]
  demandes: { en_attente: number; accordees: number; refusees: number; delai_moyen_heures: number | null }
}

export interface LigneTeletravail {
  personne_id: string
  prenom: string
  nom: string
  service: string
  jours_tt: number          // jours avec au moins un pointage « Télétravail » (indemnité)
  dates: string[]
  jours_habituels: number[]
  indemnite_centimes?: number   // selon Admin › Réglages › Télétravail
}

export interface LigneMensuelle {
  personne_id: string
  prenom: string
  nom: string
  service: string
  regime: string | null
  jours_prevus: number
  jours_presents: number
  jours_tt: number
  a_prester: number
  preste: number
  boni: number
  conges: number
  maladie: number
  autres_absences: number
  jours_non_justifies: number
  jours_incomplets: number
}

export interface MouvementCompteur { id: number; compteur_code: string; compteur: string; date_effet: string; type: string; minutes: number; motif: string | null; par: string; cree_le: string }
export interface ApercuDepart { soldes: { compteur: string; reste_min: number }[]; demandes_apres: number; chef_de: string[]; acces_delegues: number; demandes_a_valider: number }
export interface Modification { id: number; quand: string; qui: string; objet: string; action: 'INSERT' | 'UPDATE' | 'DELETE'; champs: string[]; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }

export interface MotDePasseGenere { email: string; nom: string; mot_de_passe: string; cree: boolean }

export interface LigneCpas {
  personne_id: string
  prenom: string
  nom: string
  partenaire: string
  service: string
  regime: string | null
  a_prester: number
  preste: number
  conges: number
  absence_justifiee: number
  absence_maladie: number
  jours_non_justifies: number
  jours_incomplets: number
  ecart: number
}

export type Role = Profil['role']

export interface AdminPersonne {
  id: string
  prenom: string
  nom: string
  email: string
  matricule: string | null
  role: Role
  type: 'interne' | 'isp'
  partenaire_isp: string | null
  service_id: string
  service: string
  date_entree: string
  date_sortie: string | null
  compte_lie: boolean
  regime_id: number | null
  regime: string | null
  regime_depuis: string | null
  testeur?: boolean
}

export interface SaisiePersonne {
  id: string | null
  prenom: string
  nom: string
  email: string
  service_id: string
  role: Role
  type: 'interne' | 'isp'
  partenaire_isp: string | null
  matricule: string | null
  date_entree: string
  date_sortie: string | null
  regime_id: number | null
}

export interface AdminService {
  id: string
  nom: string
  parent_id: string | null
  couleur: string | null
  seuil_absence_pct: number
  actif: boolean
  chefs: string[]
  effectif: number
}

export interface Regime {
  id: number
  libelle: string
  contrat: 'temps_plein' | 'temps_partiel' | 'isp'
  minutes_jour: number[]
  minutes_semaine: number
  actif: boolean
  utilisations: number
}

export interface Acces { personne_id: string; prenom: string; nom: string; service_id: string; service: string; peut_valider: boolean; jusqu_au?: string | null; actif?: boolean }
export interface Parametre {
  cle: string; valeur: number; unite: string; libelle: string; provisoire: boolean; source: string | null; categorie: string
  parent?: string | null      // réglage d'une fonction : masqué quand la fonction est coupée
  options?: string[] | null   // oui/non présenté comme un choix entre deux modalités
  ordre?: number; aide?: string | null
}
export interface Compteur {
  code: string; libelle: string; periodicite: 'annuelle' | 'trimestrielle' | 'aucune'; visible_employe: boolean; autorise_negatif: boolean
  ordre: number; actif: boolean; report_mode: 'perdu' | 'total' | 'plafonne'; report_vers: string | null; report_plafond_min: number | null; regle_provisoire: boolean
}
export interface ServiceSuivi { service_id: string; nom: string; suivi: boolean; effectif: number; chef_absent_aujourdhui: boolean }
export interface PersonneVisible { id: string; prenom: string; nom: string; service: string }
export interface Ferie { jour: string; libelle: string; recuperable: boolean }
export interface Reseau { plage: string; libelle: string }

export interface Api {
  mode: 'supabase' | 'demo'
  profil(): Promise<Profil>
  typesPointage(): Promise<TypePointage[]>
  pointages(depuis: string, jusqua: string): Promise<Pointage[]>
  pointer(d: DemandePointage): Promise<Pointage>
  corriger(horodatage: string, sens: Sens, remarque?: string): Promise<void>
  annulerPointage(id: string): Promise<void>
  journee(jour: string): Promise<Journee>
  soldeBoni(): Promise<number>
  anomalies(): Promise<Anomalie[]>
  presence(): Promise<Presence[]>
  notifications(): Promise<Notif[]>
  marquerLu(): Promise<void>
  configPublique(): Promise<{ vapid_public?: string | null; appli_url?: string | null }>
  enregistrerPush(endpoint: string, p256dh: string, auth: string): Promise<void>
  retirerPush(endpoint: string): Promise<void>
  soldes(): Promise<Solde[]>
  codesAbsence(): Promise<CodeAbsence[]>
  simuler(s: SaisieDemande): Promise<Simulation>
  soumettre(s: SaisieDemande): Promise<void>
  mesDemandes(): Promise<Demande[]>
  aValider(): Promise<Demande[]>
  /** Demandes accordées ou refusées ces 60 derniers jours, parmi celles que je peux voir */
  decisionsRecentes(): Promise<Demande[]>
  /** Admin, admin RH : erreurs remontées par l'appli (regroupées) */
  erreursRecentes(jours?: number): Promise<{ quand: string; qui: string | null; ecran: string | null; message: string; version: string | null; navigateur: string | null; fois: number }[]>
  decider(ids: string[], accorder: boolean, commentaire?: string): Promise<number>
  annulerDemande(id: string, motif?: string): Promise<void>
  // Espace RH
  personnes(): Promise<Personne[]>
  anomaliesTous(): Promise<AnomalieRH[]>
  corrigerPour(personneId: string, horodatage: string, sens: Sens, remarque?: string): Promise<void>
  encoderAbsence(personneId: string, s: SaisieDemande): Promise<void>
  aConstater(): Promise<Demande[]>
  constater(ids: string[]): Promise<number>
  propositionConges(annee: number): Promise<PropositionConges[]>
  attribuerConges(annee: number, personnes?: string[]): Promise<number>
  soldesPersonne(personneId: string): Promise<Solde[]>
  mouvementsPersonne(personneId: string): Promise<MouvementCompteur[]>
  ajusterSolde(personneId: string, compteur: string, minutes: number, motif: string): Promise<void>
  /** Reprise d'un solde (ex. depuis Dinclock) : mouvement « ouverture » à une date */
  reprendreSolde(personneId: string, compteur: string, minutes: number, dateEffet: string, motif: string): Promise<void>
  preparerDepart(personneId: string, date: string): Promise<ApercuDepart>
  enregistrerDepart(personneId: string, date: string, motif?: string): Promise<{ demandes_annulees: number }>
  annulerDepart(personneId: string): Promise<void>
  journal(limite?: number, objet?: string | null): Promise<Modification[]>
  etatCloture(mois: string): Promise<EtatCloture>
  cloturer(mois: string): Promise<{ reports_boni: number; boni_hors_limites: number }>
  heuresAValider(): Promise<HeureAValider[]>
  deciderHeures(personneId: string, jour: string, accorder: boolean, commentaire?: string): Promise<void>
  // Rapports
  statsDirection(mois: string): Promise<StatsDirection>
  rapportCpas(mois: string): Promise<LigneCpas[]>
  rapportTeletravail(mois: string): Promise<LigneTeletravail[]>
  /** Récap du mois par personne visible (équipe pour un chef, tout le CFB pour RH / direction) */
  rapportMensuel(mois: string): Promise<LigneMensuelle[]>
  // Administration
  adminPersonnes(): Promise<AdminPersonne[]>
  enregistrerPersonne(p: SaisiePersonne): Promise<string>
  delierCompte(personneId: string): Promise<void>
  /** RH / admin : crée le compte (ou génère un nouveau mot de passe) ; le mot de passe n'est renvoyé qu'une fois */
  genererMotDePasse(personneId: string): Promise<MotDePasseGenere>
  /** Moyens de connexion du compte actuel */
  connexion(): Promise<{ motDePasse: boolean; microsoft: boolean }>
  changerMotDePasse(actuel: string, nouveau: string): Promise<void>
  /** Lien d'abonnement agenda (Outlook…) : congés accordés + fériés. `regenerer` invalide l'ancien. */
  lienAgenda(regenerer?: boolean): Promise<string>
  /** Double authentification (application d'authentification, code à 6 chiffres) */
  mfaEtat(): Promise<{ facteurs: { id: string; nom: string }[]; niveau: 'aal1' | 'aal2'; requisPossible: boolean }>
  mfaInscrire(): Promise<{ id: string; qr: string; secret: string }>
  mfaVerifier(facteurId: string, code: string): Promise<void>
  mfaRetirer(facteurId: string): Promise<void>
  changerRegime(personneId: string, regimeId: number, debut: string): Promise<void>
  /** Régime aux jours choisis (4/5, 3/5… le jour libre varie) : réutilise un régime identique ou le crée */
  regimePersonnalise(personneId: string, minutesJour: number[], debut: string): Promise<number>
  adminServices(): Promise<AdminService[]>
  enregistrerService(s: Omit<AdminService, 'effectif' | 'id'> & { id: string | null }): Promise<string>
  regimes(): Promise<Regime[]>
  enregistrerRegime(r: { id: number | null; libelle: string; contrat: Regime['contrat']; minutes_jour: number[]; actif: boolean }): Promise<number>
  acces(): Promise<Acces[]>
  /** `jusquAu` : dernier jour de l'accès (remplacement pendant un congé), null = sans limite */
  donnerAcces(personneId: string, serviceId: string, peutValider: boolean, jusquAu?: string | null): Promise<void>
  retirerAcces(personneId: string, serviceId: string): Promise<void>
  parametres(): Promise<Parametre[]>
  modifierParametre(cle: string, valeur: number, source: string): Promise<void>
  feries(): Promise<Ferie[]>
  enregistrerFerie(jour: string, libelle: string, supprimer?: boolean): Promise<void>
  reseaux(): Promise<Reseau[]>
  enregistrerReseau(plage: string, libelle: string, supprimer?: boolean): Promise<void>
  envoyerRappel(ids: string[], message?: string): Promise<number>
  personnesVisibles(): Promise<PersonneVisible[]>
  servicesSuivis(): Promise<ServiceSuivi[]>
  teletravailDe(personneId: string): Promise<{ jours: number[]; modifiable: boolean }>
  definirTeletravail(personneId: string, jours: number[]): Promise<void>
  horaireDe(personneId?: string): Promise<Horaire>
  definirHoraire(arrivee: number | null, depart: number | null, personneId?: string): Promise<void>
  terminerAccueil(): Promise<void>
  signalerInfo(champ: ChampSignale, message?: string): Promise<number>
  mesSignalements(): Promise<Signalement[]>
  signalementsOuverts(): Promise<Signalement[]>
  traiterSignalement(id: number): Promise<void>
  santeSysteme(): Promise<SanteSysteme>
  suiviAdoption(): Promise<LigneAdoption[]>
  sansCompteParService(): Promise<ComptesService[]>
  donnerAvis(type: TypeAvis, message?: string, ecran?: string, parametre?: string): Promise<number>
  mesAvis(): Promise<Avis[]>
  avisRecus(): Promise<Avis[]>
  traiterAvis(id: number, traite?: boolean): Promise<void>
  definirTesteur(personneId: string, testeur: boolean): Promise<void>
  deposerJustificatif(d: Demande, fichier: File): Promise<void>
  justificatifsManquants(): Promise<Demande[]>
  lienJustificatif(chemin: string): Promise<string>
  retirerJustificatif(d: Demande): Promise<void>
  suivreService(serviceId: string, suivre: boolean): Promise<void>
  journeesPersonne(personneId: string, debut: string, fin: string): Promise<Journee[]>
  pointagesPersonne(personneId: string, debut: string, fin: string): Promise<Pointage[]>
  absencesPersonne(personneId: string, debut: string, fin: string): Promise<Demande[]>
  demandesEquipe(debut: string, fin: string): Promise<Demande[]>
  compteurs(): Promise<Compteur[]>
  enregistrerCompteur(c: Compteur): Promise<void>
  deconnexion(): Promise<void>
}
