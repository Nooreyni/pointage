// Mode démo : données FICTIVES en mémoire, sans serveur (présentation et tests d'interface).
// Les règles de calcul reprennent celles du serveur (pause 30 min au-delà de 6 h, plafond 9 h).
import type { Anomalie, Api, CodeAbsence, Demande, Journee, Notif, Pointage, Presence, Profil, SaisieDemande, Sens, Simulation } from './types'
import { decalerJour, isoBxl, jourBxl } from './temps'

const REGIME = [456, 456, 456, 456, 456, 0, 0]
const PAUSE = 30, SEUIL_PAUSE = 360, MAX_JOUR = 540
const FERIES = new Set(['2026-11-01', '2026-11-11', '2026-12-25', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06',
                        '2027-05-17', '2027-07-21', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25'])
const CODES: CodeAbsence[] = [
  ['CP', 'Congés payés', 'VA', 'CONGE_LEGAL'], ['CP_N1', 'Congé année −1', 'V-1', 'CONGE_N1'],
  ['CEL', 'Jour de congé extra-légal', 'EL', 'EXTRA_LEGAL'], ['ANC', 'Congé ancienneté', 'ANC', 'ANCIENNETE'],
  ['RECUP', 'Récup', 'RECUP', 'RECUP'], ['RECUP_JC', 'Récupération jour communautaire', 'JC', null],
].map(([code, libelle, code_court, compteur_code], i) => ({ code, libelle, code_court, compteur_code, justificatif_requis: false, ordre: i }) as CodeAbsence)

export type Persona = 'employe' | 'chef'

function prevues(jour: string): number {
  if (FERIES.has(jour)) return 0
  const iso = (new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7
  return REGIME[iso]
}

function minutesDemande(s: SaisieDemande): number {
  if (s.type === 'conge_heures') return s.minutes ?? 0
  if (s.type === 'conge_demi_jour') return Math.floor(prevues(s.debut) / 2)
  let total = 0
  for (let j = s.debut; j <= s.fin; j = decalerJour(j, 1)) total += prevues(j)
  return total
}

export function calculerJournee(jour: string, pts: Pointage[]): Journee {
  const liste = pts.filter((p) => p.jour === jour && !p.annule).sort((a, b) => a.horodatage.localeCompare(b.horodatage))
  let brut = 0, pausePointee = 0, complete = true
  liste.forEach((p, i) => {
    const suiv = liste[i + 1], prec = liste[i - 1]
    const ecart = suiv ? (Date.parse(suiv.horodatage) - Date.parse(p.horodatage)) / 60000 : 0
    if (p.sens === 'entree' && suiv?.sens === 'sortie') brut += ecart
    if (p.sens === 'sortie' && suiv?.sens === 'entree') pausePointee += ecart
    if ((p.sens === 'entree' && suiv?.sens !== 'sortie') || (p.sens === 'sortie' && prec?.sens !== 'entree')) complete = false
  })
  brut = Math.round(brut)
  const pause = brut > SEUIL_PAUSE ? Math.max(0, PAUSE - Math.round(pausePointee)) : 0
  const p = prevues(jour)
  return {
    jour, prevues: p, absence: 0, a_prester: p, nb_pointages: liste.length, brut, pause_deduite: pause,
    preste: brut - pause,
    boni: liste.length === 0 || !complete ? 0 : Math.min(brut - pause, MAX_JOUR) - p,
    depassement: complete ? Math.max(0, brut - pause - MAX_JOUR) : 0,
    complete,
  }
}

export function apiDemo(persona: Persona = 'employe'): Api {
  const aujourdhui = jourBxl()
  const profil: Profil = persona === 'chef'
    ? { id: 'demo', prenom: 'Marc', nom: 'Dupont', email: 'marc.dupont@cfb.test', role: 'employe', type: 'interne',
        service: 'Administration', regime: 'Temps plein 38h', minutes_jour: REGIME, est_chef_service: true }
    : { id: 'demo', prenom: 'Sofia', nom: 'Janssens', email: 'sofia.janssens@cfb.test', role: 'employe', type: 'interne',
        service: 'Administration', regime: 'Temps plein 38h', minutes_jour: REGIME, est_chef_service: false }

  // Congés : soldes d'ouverture + demandes (les siennes et, pour le chef, celles de l'équipe)
  const ouverture: Record<string, number> = { CONGE_LEGAL: 9120, EXTRA_LEGAL: 912, RECUP: 220 }
  let numero = 40
  const demande = (personne_id: string, prenom: string, nom: string, s: SaisieDemande, statut: Demande['statut'], cree = aujourdhui): Demande => ({
    id: crypto.randomUUID(), numero: ++numero, personne_id, prenom, nom, type: s.type, code_absence: s.code_absence,
    libelle_absence: CODES.find((c) => c.code === s.code_absence)?.libelle ?? s.code_absence,
    date_debut: s.debut, date_fin: s.fin, demi: s.demi, minutes_decomptees: minutesDemande(s), commentaire: s.commentaire ?? null,
    statut, decide_le: statut === 'en_attente' ? null : new Date().toISOString(), commentaire_decision: null,
    cree_le: `${cree}T09:00:00Z`, je_peux_valider: personne_id !== 'demo' && statut === 'en_attente',
  })
  const lundi = (n: number) => { let j = decalerJour(aujourdhui, 7 * n); while (new Date(`${j}T12:00:00Z`).getUTCDay() !== 1) j = decalerJour(j, 1); return j }
  const demandes: Demande[] = [
    demande('demo', profil.prenom, profil.nom, { type: 'conge_jours', code_absence: 'CP', debut: '2026-08-10', fin: '2026-08-14', demi: null, minutes: null }, 'accordee', '2026-07-01'),
    demande('demo', profil.prenom, profil.nom, { type: 'conge_demi_jour', code_absence: 'CEL', debut: decalerJour(lundi(3), 2), fin: decalerJour(lundi(3), 2), demi: 'apres_midi', minutes: null }, 'en_attente'),
    demande('p1', 'Yanis', 'Peeters', { type: 'conge_jours', code_absence: 'CP', debut: lundi(2), fin: decalerJour(lundi(2), 4), demi: null, minutes: null, commentaire: 'Vacances de Noël' }, 'en_attente', decalerJour(aujourdhui, -4)),
    demande('p2', 'Awa', 'Diallo', { type: 'conge_jours', code_absence: 'RECUP', debut: decalerJour(lundi(2), 1), fin: decalerJour(lundi(2), 1), demi: null, minutes: null }, 'en_attente', decalerJour(aujourdhui, -1)),
    demande('p3', 'Jordan', 'Kabongo', { type: 'conge_heures', code_absence: 'RECUP', debut: decalerJour(lundi(1), 3), fin: decalerJour(lundi(1), 3), demi: null, minutes: 120 }, 'en_attente'),
  ]
  const compteurDe = (code: string) => CODES.find((c) => c.code === code)?.compteur_code ?? null
  const solde = (compteur: string, avecAttente: boolean) => (ouverture[compteur] ?? 0) - demandes
    .filter((d) => d.personne_id === 'demo' && compteurDe(d.code_absence) === compteur
                   && (d.statut === 'accordee' || (avecAttente && d.statut === 'en_attente')))
    .reduce((t, d) => t + d.minutes_decomptees, 0)
  const pts: Pointage[] = []
  const ajouter = (jour: string, min: number, sens: Sens, type = 'BUREAU') => {
    const h = isoBxl(jour, min)
    pts.push({ id: crypto.randomUUID(), horodatage: h, jour, sens, type_code: type, source: 'web',
               lieu: type === 'TT' ? 'externe' : 'reseau_cfb', remarque: null, annule: false, annule_motif: null, cree_le: h })
  }
  // 15 jours ouvrés passés, dont une sortie oubliée
  for (let i = 21; i >= 1; i--) {
    const j = decalerJour(aujourdhui, -i)
    if (prevues(j) === 0) continue
    const tt = i % 5 === 2
    ajouter(j, 480 + (i % 4) * 4, 'entree', tt ? 'TT' : 'BUREAU')
    if (i !== 3) ajouter(j, 968 + (i % 3) * 6, 'sortie', tt ? 'TT' : 'BUREAU')
  }

  const presence: Presence[] = [
    ['Marc', 'Dupont', 'Administration', true, 'Présent'], ['Yanis', 'Peeters', 'Administration', true, 'Télétravail'],
    ['Awa', 'Diallo', 'Administration', true, 'Absent'], ['Jordan', 'Kabongo', 'Administration', true, 'Pas encore pointé'],
    ['Lucas', 'Martin', 'IT', false, 'Présent'], ['Emma', 'Claes', 'IT', false, 'En formation'],
    ['Nadia', 'Benali', 'Ressources humaines', false, 'Présent'], ['Paul', 'Renard', 'Logistique', false, 'En mission'],
  ].map(([prenom, nom, service, mon_service, statut], i) => ({
    personne_id: `p${i}`, prenom, nom, service, mon_service, statut, depuis: null,
  }) as Presence)

  const notifs: Notif[] = [{
    id: 1, type: 'fin_mois', titre: '1 jour à régulariser avant la fin du mois',
    corps: 'Corrige-le en 1 clic pour que la RH puisse clôturer.', lien: '/', cree_le: new Date().toISOString(), lu_le: null,
  }]

  const attendre = () => new Promise((r) => setTimeout(r, 150))

  return {
    mode: 'demo',
    async profil() { return profil },
    async typesPointage() {
      return ['Bureau', 'Télétravail', 'Visite', 'Mission', 'Formation', 'Mandat', 'VAD Permanence']
        .map((libelle, i) => ({ code: ['BUREAU', 'TT', 'VISITE', 'MISSION', 'FORMATION', 'MANDAT', 'PERMANENCE_VAD'][i], libelle, ordre: i }))
    },
    async pointages(depuis, jusqua) { return pts.filter((p) => p.jour >= depuis && p.jour <= jusqua) },
    async pointer(d) {
      await attendre()
      const existant = pts.find((p) => p.id === d.client_id)
      if (existant) return existant
      const h = d.horodatage ?? new Date().toISOString()
      const jour = jourBxl(new Date(h))
      const dernier = pts.filter((p) => p.jour === jour && !p.annule).at(-1)
      const sens: Sens = dernier?.sens === 'entree' ? 'sortie' : 'entree'
      const p: Pointage = {
        id: d.client_id, horodatage: h, jour, sens,
        type_code: d.type_code ?? (sens === 'sortie' && dernier ? dernier.type_code : 'BUREAU'),
        source: 'web', lieu: 'reseau_cfb', remarque: d.remarque ?? null, annule: false, annule_motif: null,
        cree_le: new Date().toISOString(),
      }
      pts.push(p)
      return p
    },
    async corriger(horodatage, sens, remarque) {
      await attendre()
      const jour = jourBxl(new Date(horodatage))
      pts.push({ id: crypto.randomUUID(), horodatage, jour, sens, type_code: 'BUREAU', source: 'correction', lieu: 'inconnu',
                 remarque: remarque ?? null, annule: false, annule_motif: null, cree_le: new Date().toISOString() })
    },
    async annulerPointage(id) {
      const p = pts.find((x) => x.id === id)
      if (!p) throw new Error('Pointage introuvable')
      if (Date.now() - Date.parse(p.cree_le) > 15 * 60_000) throw new Error('Annulation possible pendant 15 min')
      p.annule = true
    },
    async journee(jour) { return calculerJournee(jour, pts) },
    async soldeBoni() {
      let total = 0
      for (let i = 1; i <= 21; i++) total += calculerJournee(decalerJour(aujourdhui, -i), pts).boni
      return total
    },
    async anomalies() {
      const r: Anomalie[] = []
      for (let i = 1; i <= 21; i++) {
        const j = decalerJour(aujourdhui, -i), jr = calculerJournee(j, pts)
        if (jr.nb_pointages === 0 && jr.a_prester > 0) r.push({ jour: j, code: 'absent', libelle: 'Absent sans justification' })
        else if (jr.nb_pointages > 0 && !jr.complete) r.push({ jour: j, code: 'pointages_incomplets', libelle: 'Sortie manquante' })
      }
      return r
    },
    async presence() { return presence },
    async notifications() { return notifs },
    async marquerLu() { notifs.forEach((n) => { n.lu_le ??= new Date().toISOString() }) },
    async soldes() {
      return [['CONGE_LEGAL', 'Congés annuels', 10, '2026-01-01'], ['EXTRA_LEGAL', 'Congés extra-légaux', 20, '2026-01-01'],
              ['RECUP', 'Récup HS', 40, '2026-10-01']].map(([code, libelle, ordre, periode]) => {
        const reste = solde(code as string, false)
        return { compteur_code: code as string, libelle: libelle as string, ordre: ordre as number, periode_debut: periode as string,
                 attribue_min: ouverture[code as string], pris_min: ouverture[code as string] - reste, reste_min: reste }
      })
    },
    async codesAbsence() { return CODES },
    async simuler(s): Promise<Simulation> {
      await attendre()
      const minutes = minutesDemande(s), compteur = compteurDe(s.code_absence)
      const avant = compteur ? solde(compteur, true) : null
      const absents = new Set(demandes.filter((d) => d.personne_id !== 'demo' && d.statut !== 'refusee' && d.statut !== 'annulee'
        && d.date_debut <= s.fin && d.date_fin >= s.debut).map((d) => d.personne_id)).size
      return { minutes, compteur, solde_avant: avant, solde_apres: avant === null ? null : avant - minutes,
               solde_negatif: avant !== null && avant - minutes < 0, collegues_absents: absents, effectif_service: 5,
               seuil_depasse: (absents + 1) * 100 > 40 * 5 }
    },
    async soumettre(s) {
      await attendre()
      if (minutesDemande(s) === 0) throw new Error('Aucune heure prévue sur cette période (week-end, férié ou jour non presté)')
      if (demandes.some((d) => d.personne_id === 'demo' && ['en_attente', 'accordee'].includes(d.statut)
                               && d.date_debut <= s.fin && d.date_fin >= s.debut && (d.type === 'conge_jours' || s.type === 'conge_jours')))
        throw new Error('Tu as déjà une demande sur cette période')
      demandes.push(demande('demo', profil.prenom, profil.nom, s, 'en_attente'))
    },
    async mesDemandes() { return demandes.filter((d) => d.personne_id === 'demo').sort((a, b) => b.date_debut.localeCompare(a.date_debut)) },
    async aValider() { return persona === 'chef' ? demandes.filter((d) => d.je_peux_valider && d.statut === 'en_attente') : [] },
    async decider(ids, accorder, commentaire) {
      await attendre()
      if (!accorder && !commentaire?.trim()) throw new Error('Un refus doit être motivé')
      for (const d of demandes.filter((x) => ids.includes(x.id))) {
        d.statut = accorder ? 'accordee' : 'refusee'; d.decide_le = new Date().toISOString(); d.commentaire_decision = commentaire ?? null
      }
      return ids.length
    },
    async annulerDemande(id) {
      const d = demandes.find((x) => x.id === id)
      if (!d) throw new Error('Demande introuvable')
      d.statut = 'annulee'
    },
    async deconnexion() { /* rien */ },
  }
}
