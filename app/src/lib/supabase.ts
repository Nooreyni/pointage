import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Api, Anomalie, CodeAbsence, Demande, DemandePointage, Journee, Notif, Pointage, Presence, Profil, SaisieDemande, Sens,
  Simulation, Solde, TypePointage } from './types'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CLE = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabase: SupabaseClient | null = URL && CLE
  ? createClient(URL, CLE, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

// Message lisible à partir d'une erreur PostgREST / réseau
export function messageErreur(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message)
  return 'Erreur inattendue'
}

function verifier<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error
  return r.data as T
}

export function apiSupabase(): Api {
  const sb = supabase!
  let monId: string | null = null

  return {
    mode: 'supabase',

    async profil() {
      const p = verifier(await sb.from('mon_profil').select('*').maybeSingle()) as Profil | null
      if (!p) throw new Error('Ton compte Microsoft n’est pas encore enregistré dans CFB Pointage. Contacte la RH.')
      monId = p.id
      return p
    },

    async typesPointage() {
      return verifier(await sb.from('types_pointage').select('*').order('ordre')) as TypePointage[]
    },

    async pointages(depuis, jusqua) {
      return verifier(await sb.from('pointages').select('*').eq('personne_id', monId!)
        .gte('jour', depuis).lte('jour', jusqua).order('horodatage')) as Pointage[]
    },

    async pointer(d: DemandePointage) {
      return verifier(await sb.rpc('pointer', {
        p_client_id: d.client_id,
        p_horodatage: d.horodatage ?? null,
        p_type_code: d.type_code ?? null,
        p_remarque: d.remarque ?? null,
        p_source: matchMedia('(display-mode: standalone)').matches ? 'mobile' : 'web',
      })) as Pointage
    },

    async corriger(horodatage: string, sens: Sens, remarque?: string) {
      verifier(await sb.rpc('corriger_pointage', { p_horodatage: horodatage, p_sens: sens, p_remarque: remarque ?? null }))
    },

    async annulerPointage(id) {
      verifier(await sb.rpc('annuler_pointage', { p_id: id }))
    },

    async journee(jour) {
      const r = verifier(await sb.rpc('journees', { p_personne_id: monId, p_debut: jour, p_fin: jour })) as Journee[]
      return r[0]
    },

    async soldeBoni() {
      return verifier(await sb.rpc('solde_boni')) as number
    },

    async anomalies() {
      return verifier(await sb.from('anomalies').select('jour, code, libelle').eq('personne_id', monId!)
        .order('jour', { ascending: false })) as Anomalie[]
    },

    async presence() {
      return verifier(await sb.rpc('presence_jour')) as Presence[]
    },

    async notifications() {
      return verifier(await sb.from('mes_notifications').select('*').order('cree_le', { ascending: false }).limit(30)) as Notif[]
    },

    async marquerLu() {
      verifier(await sb.rpc('marquer_lu', {}))
    },

    async soldes() {
      return verifier(await sb.from('soldes').select('*').eq('personne_id', monId!)
        .order('ordre').order('periode_debut', { ascending: false })) as Solde[]
    },

    async codesAbsence() {
      return verifier(await sb.from('codes_absence').select('*').order('ordre')) as CodeAbsence[]
    },

    async simuler(s: SaisieDemande) {
      return verifier(await sb.rpc('simuler_demande', paramsDemande(s))) as Simulation
    },

    async soumettre(s: SaisieDemande) {
      verifier(await sb.rpc('soumettre_demande', { ...paramsDemande(s), p_commentaire: s.commentaire ?? null }))
    },

    async mesDemandes() {
      return verifier(await sb.from('demandes').select('*').eq('personne_id', monId!)
        .order('date_debut', { ascending: false }).limit(50)) as Demande[]
    },

    async aValider() {
      return verifier(await sb.from('demandes').select('*').eq('statut', 'en_attente').eq('je_peux_valider', true)
        .order('date_debut')) as Demande[]
    },

    async decider(ids, accorder, commentaire) {
      return verifier(await sb.rpc('decider', { p_ids: ids, p_accorder: accorder, p_commentaire: commentaire ?? null })) as number
    },

    async annulerDemande(id, motif) {
      verifier(await sb.rpc('annuler_demande', { p_id: id, p_motif: motif ?? null }))
    },

    async deconnexion() {
      await sb.auth.signOut()
    },
  }
}

function paramsDemande(s: SaisieDemande) {
  return {
    p_type: s.type, p_code_absence: s.code_absence, p_debut: s.debut,
    p_fin: s.type === 'conge_jours' ? s.fin : s.debut,
    p_demi: s.type === 'conge_demi_jour' ? s.demi : null,
    p_minutes: s.type === 'conge_heures' ? s.minutes : null,
  }
}
