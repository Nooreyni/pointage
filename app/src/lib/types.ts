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
  deconnexion(): Promise<void>
}
