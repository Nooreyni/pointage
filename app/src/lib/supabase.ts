import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ServiceSuivi, Acces, AdminPersonne, AdminService, Compteur, Ferie, Parametre, PersonneVisible, Regime, Reseau } from './types'
import type { Api, Anomalie, AnomalieRH, CodeAbsence, Demande, DemandePointage, EtatCloture, HeureAValider, Journee, Notif, Personne,
  LigneCpas, Pointage, Presence, Profil, PropositionConges, SaisieDemande, Sens, Simulation, Solde, StatsDirection,
  TypePointage } from './types'

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
      let p = verifier(await sb.from('mon_profil').select('*').maybeSingle()) as Profil | null
      // Pas encore lié (personne ajoutée après le 1er login, adresse corrigée…) : tentative de liaison vérifiée
      if (!p && verifier(await sb.rpc('lier_mon_compte'))) p = verifier(await sb.from('mon_profil').select('*').maybeSingle()) as Profil | null
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

    async configPublique() {
      return (verifier(await sb.rpc('config_publique')) ?? {}) as { vapid_public?: string | null; appli_url?: string | null }
    },
    async enregistrerPush(endpoint, p256dh, auth) {
      verifier(await sb.rpc('enregistrer_push', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }))
    },
    async retirerPush(endpoint) {
      verifier(await sb.rpc('retirer_push', { p_endpoint: endpoint }))
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

    async personnes() {
      return verifier(await sb.from('personnes').select('id, prenom, nom, service, type, role')
        .is('date_sortie', null).order('nom')) as Personne[]
    },

    async anomaliesTous() {
      return verifier(await sb.from('anomalies').select('personne_id, jour, code, libelle').order('jour', { ascending: false })) as AnomalieRH[]
    },

    async corrigerPour(personneId, horodatage, sens, remarque) {
      verifier(await sb.rpc('corriger_pointage_rh', { p_personne_id: personneId, p_horodatage: horodatage, p_sens: sens,
                                                      p_remarque: remarque ?? null }))
    },

    async encoderAbsence(personneId, s) {
      verifier(await sb.rpc('encoder_absence_rh', { p_personne_id: personneId, ...paramsDemande(s), p_commentaire: s.commentaire ?? null }))
    },

    async aConstater() {
      return verifier(await sb.from('demandes').select('*').eq('statut', 'accordee').is('constate_le', null)
        .order('date_debut')) as Demande[]
    },

    async constater(ids) {
      return verifier(await sb.rpc('constater', { p_ids: ids })) as number
    },

    async propositionConges(annee) {
      return verifier(await sb.rpc('proposition_conges', { p_annee: annee })) as PropositionConges[]
    },

    async attribuerConges(annee) {
      return verifier(await sb.rpc('attribuer_conges', { p_annee: annee })) as number
    },

    async etatCloture(mois) {
      return verifier(await sb.rpc('etat_cloture', { p_mois: mois })) as EtatCloture
    },

    async cloturer(mois) {
      return verifier(await sb.rpc('cloturer_mois', { p_mois: mois })) as { reports_boni: number; boni_hors_limites: number }
    },

    async heuresAValider() {
      return verifier(await sb.rpc('heures_a_valider')) as HeureAValider[]
    },

    async deciderHeures(personneId, jour, accorder, commentaire) {
      verifier(await sb.rpc('decider_heures', { p_personne_id: personneId, p_jour: jour, p_accorder: accorder,
                                                p_commentaire: commentaire ?? null }))
    },

    async statsDirection(mois) {
      return verifier(await sb.rpc('stats_direction', { p_mois: mois })) as StatsDirection
    },

    async rapportCpas(mois) {
      return verifier(await sb.rpc('rapport_cpas', { p_mois: mois })) as LigneCpas[]
    },

    async adminPersonnes() {
      return verifier(await sb.from('admin_personnes').select('*').order('nom')) as AdminPersonne[]
    },
    async enregistrerPersonne(p) {
      return verifier(await sb.rpc('enregistrer_personne', {
        p_id: p.id, p_prenom: p.prenom, p_nom: p.nom, p_email: p.email, p_service_id: p.service_id, p_role: p.role, p_type: p.type,
        p_partenaire_isp: p.partenaire_isp, p_matricule: p.matricule, p_date_entree: p.date_entree, p_date_sortie: p.date_sortie,
        p_regime_id: p.regime_id,
      })) as string
    },
    async delierCompte(personneId) {
      verifier(await sb.rpc('delier_compte', { p_personne_id: personneId }))
    },
    async changerRegime(personneId, regimeId, debut) {
      verifier(await sb.rpc('changer_regime', { p_personne_id: personneId, p_regime_id: regimeId, p_debut: debut }))
    },
    async adminServices() {
      return verifier(await sb.from('admin_services').select('*').order('nom')) as AdminService[]
    },
    async enregistrerService(s) {
      return verifier(await sb.rpc('enregistrer_service', {
        p_id: s.id, p_nom: s.nom, p_parent_id: s.parent_id, p_couleur: s.couleur, p_seuil_absence_pct: s.seuil_absence_pct,
        p_actif: s.actif, p_chefs: s.chefs,
      })) as string
    },
    async regimes() {
      return verifier(await sb.from('regimes').select('*').order('libelle')) as Regime[]
    },
    async enregistrerRegime(r) {
      return verifier(await sb.rpc('enregistrer_regime', { p_id: r.id, p_libelle: r.libelle, p_contrat: r.contrat,
                                                          p_minutes_jour: r.minutes_jour, p_actif: r.actif })) as number
    },
    async acces() {
      return verifier(await sb.from('admin_acces').select('*').order('nom')) as Acces[]
    },
    async donnerAcces(personneId, serviceId, peutValider) {
      verifier(await sb.rpc('donner_acces_service', { p_personne_id: personneId, p_service_id: serviceId, p_peut_valider: peutValider }))
    },
    async retirerAcces(personneId, serviceId) {
      verifier(await sb.rpc('retirer_acces_service', { p_personne_id: personneId, p_service_id: serviceId }))
    },
    async parametres() {
      return verifier(await sb.from('parametres').select('*').order('cle')) as Parametre[]
    },
    async modifierParametre(cle, valeur, source) {
      verifier(await sb.rpc('modifier_parametre', { p_cle: cle, p_valeur: valeur, p_source: source }))
    },
    async feries() {
      return verifier(await sb.from('jours_feries').select('*').gte('jour', `${new Date().getFullYear() - 1}-01-01`).order('jour')) as Ferie[]
    },
    async enregistrerFerie(jour, libelle, supprimer) {
      verifier(await sb.rpc('enregistrer_ferie', { p_jour: jour, p_libelle: libelle, p_supprimer: !!supprimer }))
    },
    async reseaux() {
      return verifier(await sb.rpc('reseaux_cfb')) as Reseau[]
    },
    async enregistrerReseau(plage, libelle, supprimer) {
      verifier(await sb.rpc('enregistrer_reseau', { p_plage: plage, p_libelle: libelle, p_supprimer: !!supprimer }))
    },

    async envoyerRappel(ids, message) {
      return verifier(await sb.rpc('envoyer_rappel', { p_ids: ids, p_message: message ?? null })) as number
    },
    async deposerJustificatif(d, fichier) {
      const ext = (fichier.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
      const chemin = `${d.personne_id}/${d.id}/${crypto.randomUUID()}.${ext}`
      const { error } = await sb.storage.from('justificatifs').upload(chemin, fichier, { contentType: fichier.type, upsert: false })
      if (error) throw new Error(`Envoi du fichier impossible : ${error.message}`)
      verifier(await sb.rpc('joindre_justificatif', { p_demande: d.id, p_chemin: chemin }))
      if (d.justificatif_chemin) await sb.storage.from('justificatifs').remove([d.justificatif_chemin])   // remplace l'ancien
    },
    async justificatifsManquants() {
      return verifier(await sb.from('demandes').select('*').eq('statut', 'accordee').eq('justificatif_requis', true)
        .eq('justificatif_joint', false).gte('date_fin', new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10))
        .order('date_debut', { ascending: false })) as Demande[]
    },
    async lienJustificatif(chemin) {
      const { data, error } = await sb.storage.from('justificatifs').createSignedUrl(chemin, 120)
      if (error || !data) throw new Error('Justificatif introuvable')
      return data.signedUrl
    },
    async retirerJustificatif(d) {
      verifier(await sb.rpc('joindre_justificatif', { p_demande: d.id, p_chemin: null }))
      if (d.justificatif_chemin) await sb.storage.from('justificatifs').remove([d.justificatif_chemin])
    },
    async teletravailDe(personneId) {
      return verifier(await sb.rpc('teletravail_de', { p_personne: personneId })) as { jours: number[]; modifiable: boolean }
    },
    async definirTeletravail(personneId, jours) {
      verifier(await sb.rpc('definir_teletravail', { p_personne: personneId, p_jours: jours }))
    },
    async servicesSuivis() {
      return verifier(await sb.rpc('services_suivis')) as ServiceSuivi[]
    },
    async suivreService(serviceId, suivre) {
      verifier(await sb.rpc('suivre_service', { p_service_id: serviceId, p_suivre: suivre }))
    },
    async journeesPersonne(personneId, debut, fin) {
      return verifier(await sb.rpc('journees', { p_personne_id: personneId, p_debut: debut, p_fin: fin })) as Journee[]
    },
    async pointagesPersonne(personneId, debut, fin) {
      return verifier(await sb.from('pointages').select('*').eq('personne_id', personneId).gte('jour', debut).lte('jour', fin)
        .order('horodatage')) as Pointage[]
    },
    async absencesPersonne(personneId, debut, fin) {
      return verifier(await sb.from('demandes').select('*').eq('personne_id', personneId).eq('statut', 'accordee')
        .lte('date_debut', fin).gte('date_fin', debut).order('date_debut')) as Demande[]
    },
    async personnesVisibles() {
      return verifier(await sb.from('personnes').select('id, prenom, nom, service').is('date_sortie', null).order('nom')) as PersonneVisible[]
    },
    async demandesEquipe(debut, fin) {
      return verifier(await sb.from('demandes').select('*').in('statut', ['en_attente', 'accordee'])
        .lte('date_debut', fin).gte('date_fin', debut).order('date_debut')) as Demande[]
    },
    async compteurs() {
      return verifier(await sb.from('compteurs').select('*').order('ordre')) as Compteur[]
    },
    async enregistrerCompteur(c) {
      verifier(await sb.rpc('enregistrer_compteur', { p_code: c.code, p_libelle: c.libelle, p_periodicite: c.periodicite,
        p_autorise_negatif: c.autorise_negatif, p_visible_employe: c.visible_employe, p_report_mode: c.report_mode,
        p_report_vers: c.report_vers, p_report_plafond_min: c.report_plafond_min, p_actif: c.actif }))
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
