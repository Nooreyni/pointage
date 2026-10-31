// Mode démo : données FICTIVES en mémoire, sans serveur (présentation et tests d'interface).
// Les règles de calcul reprennent celles du serveur (pause 30 min au-delà de 6 h, plafond 9 h).
import type { Acces, AdminPersonne, AdminService, Ferie, Parametre, Regime, Reseau } from './types'
import type { Anomalie, AnomalieRH, Api, CodeAbsence, Demande, EtatCloture, HeureAValider, Journee, Notif, Personne, Pointage, Presence,
  LigneCpas, Profil, SaisieDemande, Sens, Simulation, StatsDirection } from './types'
import { decalerJour, isoBxl, jourBxl } from './temps'

const REGIME = [456, 456, 456, 456, 456, 0, 0]
const PAUSE = 30, SEUIL_PAUSE = 360, MAX_JOUR = 540
const FERIES = new Set(['2026-11-01', '2026-11-11', '2026-12-25', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06',
                        '2027-05-17', '2027-07-21', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25'])
const CODES: CodeAbsence[] = ([
  ['CP', 'Congés payés', 'VA', 'CONGE_LEGAL', true], ['CP_N1', 'Congé année −1', 'V-1', 'CONGE_N1', true],
  ['CEL', 'Jour de congé extra-légal', 'EL', 'EXTRA_LEGAL', true], ['ANC', 'Congé ancienneté', 'ANC', 'ANCIENNETE', true],
  ['RECUP', 'Récup', 'RECUP', 'RECUP', true], ['RECUP_JC', 'Récupération jour communautaire', 'JC', null, true],
  ['MAL', 'Maladie', 'Mal', null, false], ['MAL_3J', 'Maladie 3 j sans certificat', 'Mal3', null, false],
  ['AT', 'Accident de travail', 'AT', null, false], ['PETIT_CHOMAGE', 'Petit chômage', 'PC', null, false],
  ['RAISONS_IMP', 'Congé familial raisons impérieuses', 'FAM', null, false], ['SANS_SOLDE', 'Congé sans solde', 'SS', null, false],
] as const).map(([code, libelle, code_court, compteur_code, demandable], i) =>
  ({ code, libelle, code_court, compteur_code, demandable, justificatif_requis: false, ordre: i }) as CodeAbsence)

const PERSONNES: Personne[] = ([
  ['Lambert', 'Claire', 'Direction', 'direction'], ['Dupont', 'Marc', 'Administration', 'employe'],
  ['Janssens', 'Sofia', 'Administration', 'employe'], ['Peeters', 'Yanis', 'Administration', 'employe'],
  ['Diallo', 'Awa', 'Administration', 'employe'], ['Kabongo', 'Jordan', 'Administration', 'employe'],
  ['Martin', 'Lucas', 'IT', 'employe'], ['Claes', 'Emma', 'IT', 'employe'], ['Benali', 'Nadia', 'Ressources humaines', 'rh'],
  ['Wouters', 'Tom', 'Ressources humaines', 'rh'], ['Leroy', 'Inès', 'Ressources humaines', 'admin_rh'],
  ['Simon', 'Léa', 'Ressources humaines', 'rh'], ['Renard', 'Paul', 'Logistique', 'employe'],
] as const).map(([nom, prenom, service, role], i) =>
  ({ id: `p${i}`, nom, prenom, service, role, type: prenom === 'Jordan' ? 'isp' : 'interne' }) as Personne)

export type Persona = 'admin' | 'employe' | 'chef' | 'rh' | 'direction'

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
  const base = { id: 'demo', type: 'interne' as const, regime: 'Temps plein 38h', minutes_jour: REGIME }
  const profil: Profil = persona === 'chef'
    ? { ...base, prenom: 'Marc', nom: 'Dupont', email: 'marc.dupont@cfb.test', role: 'employe', service: 'Administration', est_chef_service: true }
    : persona === 'admin'
    ? { ...base, prenom: 'Admin', nom: 'IT', email: 'admin.it@cfb.test', role: 'admin', service: 'IT', est_chef_service: false }
    : persona === 'direction'
    ? { ...base, prenom: 'Claire', nom: 'Lambert', email: 'claire.lambert@cfb.test', role: 'direction', service: 'Direction', est_chef_service: true }
    : persona === 'rh'
    ? { ...base, prenom: 'Nadia', nom: 'Benali', email: 'nadia.benali@cfb.test', role: 'rh', service: 'Ressources humaines', est_chef_service: false }
    : { ...base, prenom: 'Sofia', nom: 'Janssens', email: 'sofia.janssens@cfb.test', role: 'employe', service: 'Administration', est_chef_service: false }

  // Congés : soldes d'ouverture + demandes (les siennes et, pour le chef, celles de l'équipe)
  const ouverture: Record<string, number> = { CONGE_LEGAL: 9120, EXTRA_LEGAL: 912, RECUP: 220 }
  let numero = 40
  const demande = (personne_id: string, prenom: string, nom: string, s: SaisieDemande, statut: Demande['statut'], cree = aujourdhui): Demande => ({
    id: crypto.randomUUID(), numero: ++numero, personne_id, prenom, nom, type: s.type, code_absence: s.code_absence,
    libelle_absence: CODES.find((c) => c.code === s.code_absence)?.libelle ?? s.code_absence,
    date_debut: s.debut, date_fin: s.fin, demi: s.demi, minutes_decomptees: minutesDemande(s), commentaire: s.commentaire ?? null,
    statut, decide_le: statut === 'en_attente' ? null : new Date().toISOString(), commentaire_decision: null,
    constate_le: null, encode_par_rh: false,
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
  demandes.push(
    demande('p6', 'Lucas', 'Martin', { type: 'conge_jours', code_absence: 'CP', debut: lundi(1), fin: decalerJour(lundi(1), 1), demi: null, minutes: null }, 'accordee'),
    demande('p12', 'Paul', 'Renard', { type: 'conge_demi_jour', code_absence: 'CEL', debut: decalerJour(lundi(1), 4), fin: decalerJour(lundi(1), 4), demi: 'matin', minutes: null }, 'accordee'),
  )
  const joursOuvresPasses = (n: number) => {
    const r: string[] = []
    for (let j = decalerJour(aujourdhui, -1); r.length < n; j = decalerJour(j, -1)) if (prevues(j) > 0) r.push(j)
    return r
  }
  const [j1, j2, j3, , j5] = joursOuvresPasses(5)
  let anomaliesRh: AnomalieRH[] = [
    { personne_id: 'p3', jour: j1, code: 'pointages_incomplets', libelle: 'Pointages incomplets (sortie manquante ?)' },
    { personne_id: 'p5', jour: j1, code: 'absent', libelle: 'Absent sans justification' },
    { personne_id: 'p5', jour: j2, code: 'absent', libelle: 'Absent sans justification' },
    { personne_id: 'p7', jour: j3, code: 'pointages_incomplets', libelle: 'Pointages incomplets (sortie manquante ?)' },
    { personne_id: 'p12', jour: j5, code: 'absent', libelle: 'Absent sans justification' },
  ]
  let heures: HeureAValider[] = [{ personne_id: 'p7', prenom: 'Emma', nom: 'Claes', jour: j2, minutes: 60 }]
  const clotures = new Set<string>(['2026-08-01'])
  // Administration (démo)
  const sid = (nom: string) => `s-${nom}`
  let services: AdminService[] = (['Direction', 'Administration', 'IT', 'Ressources humaines', 'Logistique'] as const).map((nom, i) => ({
    id: sid(nom), nom, parent_id: i === 0 ? null : sid('Direction'), couleur: ['#223A87', '#2479BE', '#A3C854', '#F7BC39', '#7A869A'][i],
    seuil_absence_pct: nom === 'Administration' ? 40 : 50, actif: true,
    chefs: nom === 'Direction' ? ['p0'] : nom === 'Administration' ? ['p1'] : nom === 'IT' ? ['p6'] : [], effectif: 0 }))
  let regimes: Regime[] = [
    [1, 'Temps plein 38h', 'temps_plein', [456, 456, 456, 456, 456, 0, 0]], [2, 'Temps plein 37h30', 'temps_plein', [450, 450, 450, 450, 450, 0, 0]],
    [3, 'Temps partiel 36h (8h × 4 + 4h mer.)', 'temps_partiel', [480, 480, 240, 480, 480, 0, 0]],
    [4, 'Temps partiel 35h (8/5h30/8/8/5h30)', 'temps_partiel', [480, 330, 480, 480, 330, 0, 0]],
  ].map(([id, libelle, contrat, minutes_jour]) => ({ id, libelle, contrat, minutes_jour, actif: true, utilisations: 0,
    minutes_semaine: (minutes_jour as number[]).reduce((a, b) => a + b, 0) }) as Regime)
  let adminP: AdminPersonne[] = [...PERSONNES, { id: 'p99', prenom: 'Admin', nom: 'IT', service: 'IT', type: 'interne', role: 'admin' } as Personne]
    .map((p) => {
      const rid = p.prenom === 'Yanis' ? 3 : ['Awa', 'Jordan'].includes(p.prenom) ? 2 : p.prenom === 'Léa' ? 4 : 1
      return { ...p, email: `${p.prenom.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${p.nom.toLowerCase()}@cfb.test`,
               matricule: p.type === 'isp' ? null : `P${p.id.slice(1).padStart(4, '0')}`, partenaire_isp: p.type === 'isp' ? 'CPAS (fictif)' : null,
               service_id: sid(p.service), date_entree: p.prenom === 'Jordan' ? '2026-09-01' : '2019-01-01', date_sortie: null,
               compte_lie: p.prenom !== 'Léa', regime_id: rid, regime: regimes.find((r) => r.id === rid)!.libelle, regime_depuis: '2025-01-01' }
    })
  let acces: Acces[] = []
  let parametres: Parametre[] = ([
    ['pause_midi_min', 30, 'min', 'Pause de midi déduite automatiquement'], ['pause_seuil_min', 360, 'min', 'Pause déduite si la journée pointée dépasse'],
    ['max_jour_min', 540, 'min', 'Maximum journalier en horaire flottant'], ['max_semaine_min', 2700, 'min', 'Maximum hebdomadaire en horaire flottant'],
    ['boni_periode_mois', 3, 'mois', 'Période de référence du boni'], ['boni_report_max_min', 720, 'min', 'Boni reportable max (crédit)'],
    ['boni_report_min_min', -720, 'min', 'Boni reportable min (débit)'], ['conges_semaines', 4, 'semaines', 'Congés annuels (semaines du régime)'],
    ['rappel_entree_delai_min', 30, 'min', 'Rappel d’entrée après l’heure habituelle'], ['relance_demande_jours', 3, 'jours', 'Relance d’une demande en attente après'],
  ] as const).map(([cle, valeur, unite, libelle]) => ({ cle, valeur, unite, libelle, provisoire: true, source: 'Valeur légale par défaut' }))
  let feries: Ferie[] = ['2026-11-01 Toussaint', '2026-11-11 Armistice', '2026-12-25 Noël', '2027-01-01 Nouvel An', '2027-03-29 Lundi de Pâques',
    '2027-05-01 Fête du Travail', '2027-05-06 Ascension', '2027-05-17 Lundi de Pentecôte', '2027-07-21 Fête nationale', '2027-08-15 Assomption']
    .map((x) => ({ jour: x.slice(0, 10), libelle: x.slice(11), recuperable: [0, 6].includes(new Date(`${x.slice(0, 10)}T12:00:00Z`).getUTCDay()) }))
  let reseaux: Reseau[] = [{ plage: '203.0.113.0/24', libelle: 'Siège (fictif)' }]
  const exigerAdmin = (rh = true) => {
    if (!(profil.role === 'admin' || (rh && profil.role === 'admin_rh'))) throw new Error('Action réservée à l’admin général')
  }

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
    async aValider() { return ['chef', 'admin', 'direction'].includes(persona) ? demandes.filter((d) => d.je_peux_valider && d.statut === 'en_attente') : [] },
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
    async personnes() { return PERSONNES },
    async anomaliesTous() { return anomaliesRh },
    async corrigerPour(personneId, horodatage) {
      await attendre()
      const jour = jourBxl(new Date(horodatage))
      anomaliesRh = anomaliesRh.filter((a) => !(a.personne_id === personneId && a.jour === jour))
    },
    async encoderAbsence(personneId, s) {
      await attendre()
      anomaliesRh = anomaliesRh.filter((a) => !(a.personne_id === personneId && a.jour >= s.debut && a.jour <= s.fin))
      const p = PERSONNES.find((x) => x.id === personneId)!
      const d = demande(personneId, p.prenom, p.nom, s, 'accordee')
      d.encode_par_rh = true; d.constate_le = new Date().toISOString()
      demandes.push(d)
    },
    async aConstater() { return demandes.filter((d) => d.statut === 'accordee' && !d.constate_le && d.personne_id !== 'demo') },
    async constater(ids) {
      demandes.filter((d) => ids.includes(d.id)).forEach((d) => { d.constate_le = new Date().toISOString() })
      return ids.length
    },
    async propositionConges(annee) {
      return PERSONNES.map((p) => {
        const mois = p.prenom === 'Jordan' ? 4 : 12
        const semaine = p.prenom === 'Yanis' ? 2160 : p.prenom === 'Léa' ? 2100 : ['Awa', 'Jordan'].includes(p.prenom) ? 2250 : 2280
        return { personne_id: p.id, prenom: p.prenom, nom: p.nom, mois_presence: mois, minutes: Math.round(4 * semaine * mois / 12),
                 regime: semaine === 2280 ? 'Temps plein 38h' : semaine === 2250 ? 'Temps plein 37h30' : `Temps partiel ${semaine / 60}h` }
      }).filter(() => annee > 0)
    },
    async attribuerConges() { await attendre(); return PERSONNES.length },
    async etatCloture(mois): Promise<EtatCloture> {
      const debut = mois.slice(0, 8) + '01'
      const parPersonne = new Map<string, number>()
      anomaliesRh.filter((a) => a.jour.startsWith(debut.slice(0, 7))).forEach((a) => parPersonne.set(a.personne_id, (parPersonne.get(a.personne_id) ?? 0) + 1))
      return {
        mois: debut, deja_cloture: clotures.has(debut), derniere_cloture: [...clotures].sort().at(-1) ?? null,
        mois_termine: debut < aujourdhui.slice(0, 8) + '01',
        anomalies: [...parPersonne].map(([id, jours]) => { const p = PERSONNES.find((x) => x.id === id)!; return { personne_id: id, prenom: p.prenom, nom: p.nom, jours } }),
        demandes_en_attente: demandes.filter((d) => d.statut === 'en_attente' && d.date_debut.slice(0, 7) <= debut.slice(0, 7)).length,
        conges_a_constater: demandes.filter((d) => d.statut === 'accordee' && !d.constate_le && d.personne_id !== 'demo').length,
      }
    },
    async cloturer(mois) {
      await attendre()
      if (mois >= aujourdhui.slice(0, 8) + '01') throw new Error('On ne clôture qu’un mois terminé')
      clotures.add(mois.slice(0, 8) + '01')
      return { reports_boni: ['03', '06', '09', '12'].includes(mois.slice(5, 7)) ? 11 : 0, boni_hors_limites: 0 }
    },
    async heuresAValider() { return heures },
    async deciderHeures(personneId, jour) { heures = heures.filter((h) => !(h.personne_id === personneId && h.jour === jour)) },
    async statsDirection(mois): Promise<StatsDirection> {
      await attendre()
      // Chiffres fictifs, stables d'un mois à l'autre (graine = mois)
      const g = Number(mois.slice(5, 7))
      const ligne = (service: string, effectif: number, abs: number, mal: number, tt: number, anom: number) => {
        const prevues = effectif * 21 * 456
        return { service, effectif, prevues, preste: Math.round(prevues * (1 - abs - mal) * 1.01),
                 absence_conge: Math.round(prevues * abs), absence_maladie: Math.round(prevues * mal), absence_autre: Math.round(prevues * 0.004),
                 jours_presence: Math.round(effectif * 21 * (1 - abs - mal)), jours_tt: Math.round(effectif * 21 * (1 - abs - mal) * tt), anomalies: anom }
      }
      return {
        debut: mois, fin: mois.slice(0, 8) + '28',
        services: [ligne('Administration', 16, 0.07 + (g % 3) / 100, 0.03, 0.22, 6), ligne('Direction', 2, 0.05, 0, 0.1, 0),
                   ligne('IT', 3, 0.06, 0.01, 0.4, 1), ligne('Logistique', 2, 0.08, 0.05, 0, 2), ligne('Ressources humaines', 4, 0.06, 0.02, 0.25, 0)],
        tendance: Array.from({ length: 6 }, (_, i) => {
          const d = new Date(`${mois}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 5 + i)
          const m = d.getUTCMonth() + 1
          return { mois: d.toISOString().slice(0, 10), taux_absence: [6.1, 5.4, 7.8, 14.2, 11.6, 8.3, 6.9, 7.2, 6.4, 7.0, 6.6, 9.8][m - 1],
                   taux_tt: [21, 23, 22, 24, 25, 23, 18, 15, 24, 26, 27, 22][m - 1] }
        }),
        demandes: { en_attente: demandes.filter((d) => d.statut === 'en_attente').length, accordees: 23, refusees: 1, delai_moyen_heures: 19.5 },
      }
    },
    async rapportCpas(): Promise<LigneCpas[]> {
      await attendre()
      return [['Kabongo', 'Jordan', 'Administration', 9450, 8820, 450, 0, 1, 1], ['Mertens', 'Lina', 'Administration', 9450, 9480, 0, 450, 0, 0],
              ['Haddad', 'Sami', 'IT', 9450, 8100, 900, 0, 2, 0]]
        .map(([nom, prenom, service, a, p, j, mal, nj, inc], i) => ({
          personne_id: `isp${i}`, prenom: prenom as string, nom: nom as string, partenaire: 'CPAS (fictif)', service: service as string,
          regime: 'Temps plein 37h30', a_prester: a as number - (j as number) - (mal as number), preste: p as number,
          absence_justifiee: j as number, absence_maladie: mal as number, jours_non_justifies: nj as number, jours_incomplets: inc as number,
          ecart: (p as number) - ((a as number) - (j as number) - (mal as number)) }))
    },
    async adminPersonnes() {
      exigerAdmin()
      return [...adminP].sort((a, b) => a.nom.localeCompare(b.nom))
    },
    async enregistrerPersonne(s) {
      exigerAdmin(); await attendre()
      if (!s.prenom.trim() || !s.nom.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) throw new Error('Prénom, nom et e-mail valide obligatoires')
      if (s.role === 'admin' && profil.role !== 'admin') throw new Error('Seul un admin général peut nommer un admin général')
      const ancien = adminP.find((p) => p.id === s.id)
      if (ancien?.role === 'admin' && (s.role !== 'admin' || s.date_sortie) && adminP.filter((p) => p.role === 'admin' && !p.date_sortie).length <= 1)
        throw new Error('Impossible : c’est le dernier admin général. Nomme d’abord un autre admin.')
      const service = services.find((x) => x.id === s.service_id)!.nom
      if (ancien) { Object.assign(ancien, { ...s, email: s.email.toLowerCase(), service, id: ancien.id }); return ancien.id }
      if (!s.regime_id) throw new Error('Choisis un régime de travail')
      const id = `n${adminP.length}`
      adminP.push({ ...s, id, email: s.email.toLowerCase(), service, compte_lie: false, regime: regimes.find((r) => r.id === s.regime_id)!.libelle,
                    regime_depuis: s.date_entree })
      return id
    },
    async changerRegime(personneId, regimeId, debut) {
      exigerAdmin(); await attendre()
      const p = adminP.find((x) => x.id === personneId)!
      if (debut <= aujourdhui) { p.regime_id = regimeId; p.regime = regimes.find((r) => r.id === regimeId)!.libelle; p.regime_depuis = debut }
    },
    async adminServices() {
      return services.map((s) => ({ ...s, effectif: adminP.filter((p) => p.service_id === s.id && !p.date_sortie).length }))
    },
    async enregistrerService(s) {
      exigerAdmin(); await attendre()
      if (s.id && s.parent_id === s.id) throw new Error('Un service ne peut pas être son propre parent')
      if (s.id) { services = services.map((x) => (x.id === s.id ? { ...x, ...s, id: x.id } : x)); return s.id }
      const id = sid(s.nom); services.push({ ...s, id, effectif: 0 }); return id
    },
    async regimes() {
      return regimes.map((r) => ({ ...r, utilisations: adminP.filter((p) => p.regime_id === r.id).length }))
    },
    async enregistrerRegime(r) {
      exigerAdmin(); await attendre()
      const semaine = r.minutes_jour.reduce((a, b) => a + b, 0)
      if (r.id) {
        const ancien = regimes.find((x) => x.id === r.id)!
        if (adminP.some((p) => p.regime_id === r.id) && ancien.minutes_jour.join() !== r.minutes_jour.join())
          throw new Error('Ce régime est déjà utilisé : crée un nouveau régime puis change celui des personnes concernées')
        Object.assign(ancien, r, { id: ancien.id, minutes_semaine: semaine }); return ancien.id
      }
      const id = Math.max(...regimes.map((x) => x.id)) + 1
      regimes.push({ ...r, id, minutes_semaine: semaine, utilisations: 0 }); return id
    },
    async acces() { return acces },
    async donnerAcces(personneId, serviceId, peutValider) {
      const p = adminP.find((x) => x.id === personneId)!, s = services.find((x) => x.id === serviceId)!
      acces = [...acces.filter((a) => !(a.personne_id === personneId && a.service_id === serviceId)),
               { personne_id: personneId, prenom: p.prenom, nom: p.nom, service_id: serviceId, service: s.nom, peut_valider: peutValider }]
    },
    async retirerAcces(personneId, serviceId) { acces = acces.filter((a) => !(a.personne_id === personneId && a.service_id === serviceId)) },
    async parametres() { return parametres },
    async modifierParametre(cle, valeur, source) {
      exigerAdmin()
      if (!source.trim()) throw new Error('Indique la source (ex. règlement de travail art. X)')
      parametres = parametres.map((p) => (p.cle === cle ? { ...p, valeur, source, provisoire: false } : p))
    },
    async feries() { return feries },
    async enregistrerFerie(jour, libelle, supprimer) {
      exigerAdmin()
      feries = supprimer ? feries.filter((f) => f.jour !== jour)
        : [...feries.filter((f) => f.jour !== jour), { jour, libelle, recuperable: [0, 6].includes(new Date(`${jour}T12:00:00Z`).getUTCDay()) }]
          .sort((a, b) => a.jour.localeCompare(b.jour))
    },
    async reseaux() { exigerAdmin(false); return reseaux },
    async enregistrerReseau(plage, libelle, supprimer) {
      exigerAdmin(false)
      if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(plage)) throw new Error('Plage IP invalide (ex. 203.0.113.0/24)')
      reseaux = supprimer ? reseaux.filter((r) => r.plage !== plage) : [...reseaux.filter((r) => r.plage !== plage), { plage, libelle }]
    },
    async deconnexion() { /* rien */ },
  }
}
