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
}

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
  code: 'absent' | 'pointages_incomplets'
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
  commentaire_decision: string | null
  constate_le: string | null
  encode_par_rh: boolean
  cree_le: string
  je_peux_valider: boolean
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
  soldes(): Promise<Solde[]>
  codesAbsence(): Promise<CodeAbsence[]>
  simuler(s: SaisieDemande): Promise<Simulation>
  soumettre(s: SaisieDemande): Promise<void>
  mesDemandes(): Promise<Demande[]>
  aValider(): Promise<Demande[]>
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
  attribuerConges(annee: number): Promise<number>
  etatCloture(mois: string): Promise<EtatCloture>
  cloturer(mois: string): Promise<{ reports_boni: number; boni_hors_limites: number }>
  heuresAValider(): Promise<HeureAValider[]>
  deciderHeures(personneId: string, jour: string, accorder: boolean, commentaire?: string): Promise<void>
  deconnexion(): Promise<void>
}
