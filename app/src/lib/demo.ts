// Mode démo : données FICTIVES en mémoire, sans serveur (présentation et tests d'interface).
// Les règles de calcul reprennent celles du serveur (pause 30 min au-delà de 6 h, plafond 9 h).
import type { Acces, AdminPersonne, AdminService, Compteur, Ferie, Parametre, PersonneVisible, Regime, Reseau } from './types'
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
  ({ code, libelle, code_court, compteur_code, demandable, justificatif_requis: ['MAL', 'AT', 'PETIT_CHOMAGE'].includes(code), ordre: i }) as CodeAbsence)

// Structure réelle du CFB (services) ; noms des personnes fictifs.
// SAF ≈ 30 personnes (le plus grand service), ES / ISP = 16 dont 14 ISP (article 60), RH = 3 RH + 1 admin RH,
// Direction, IT (1 personne), Logistique et SIPP (services sans équipe), Compta, CEFOR, TS, Coordination.
// Effectifs de Compta, CEFOR, TS et Coordination : estimés (total 68 = comptes Dinclock), à corriger.
const PERSONNES: Personne[] = ([
  ['Lambert', 'Claire', 'Direction', 'direction'], ['Dupont', 'Marc', 'SAF', 'employe'],
  ['Janssens', 'Sofia', 'SAF', 'employe'], ['Peeters', 'Yanis', 'SAF', 'employe'],
  ['Diallo', 'Awa', 'SAF', 'employe'], ['Kabongo', 'Jordan', 'ES / ISP', 'employe'],
  ['Martin', 'Lucas', 'SAF', 'employe'], ['Claes', 'Emma', 'ES / ISP', 'employe'], ['Benali', 'Nadia', 'Ressources humaines', 'rh'],
  ['Wouters', 'Tom', 'Ressources humaines', 'rh'], ['Leroy', 'Inès', 'Ressources humaines', 'admin_rh'],
  ['Simon', 'Léa', 'Ressources humaines', 'rh'], ['Renard', 'Paul', 'Logistique', 'employe'],
] as const).map(([nom, prenom, service, role], i) =>
  ({ id: `p${i}`, nom, prenom, service, role, type: prenom === 'Jordan' ? 'isp' : 'interne' }) as Personne)

// Figurants pour atteindre l'effectif de chaque service (noms fictifs, générés)
const PRENOMS = ['Amine', 'Julie', 'Kevin', 'Sarah', 'Mehdi', 'Laura', 'Thomas', 'Fatima', 'Nicolas', 'Chloé', 'Youssef', 'Manon', 'Antoine',
  'Aïcha', 'Maxime', 'Camille', 'Ibrahim', 'Elise', 'Hugo', 'Mariam', 'Simon', 'Noor', 'Arthur', 'Zoé', 'Bilal', 'Margaux', 'Jonas', 'Salma']
const NOMS = ['Mertens', 'Willems', 'El Amrani', 'Goossens', 'Lemaire', 'Nkosi', 'Dubois', 'Maes', 'Bakkali', 'Hermans', 'Lefèvre', 'Jacobs',
  'Mbaye', 'Vermeulen', 'Collin', 'Aydin', 'Michel', 'Desmet', 'Ouali', 'Pirlot', 'Lambrecht', 'Moreau', 'Ndiaye', 'Smets', 'Gilson', 'Rahmani']
// SAF : 5 personnes nommées + 25 = 30 ; ES / ISP : Jordan (ISP) + Emma (encadrement) + 14 = 16, dont 14 ISP au total
const REPARTITION: [string, number][] = [['SAF', 25], ['ES / ISP', 14], ['Logistique', 1], ['SIPP', 1],
  ['Compta', 3], ['CEFOR', 5], ['TS', 3], ['Coordination', 2]]
let rang = 0
for (const [service, n] of REPARTITION) for (let k = 0; k < n; k++, rang++) {
  PERSONNES.push({ id: `p${13 + rang}`, prenom: PRENOMS[(rang * 5 + 1) % PRENOMS.length], nom: NOMS[(rang * 11 + 3) % NOMS.length], service,
                   role: 'employe', type: service === 'ES / ISP' && k < 13 ? 'isp' : 'interne' } as Personne)
}
// Le service IT (une personne) = le compte admin général
PERSONNES.push({ id: 'p99', prenom: 'Admin', nom: 'IT', service: 'IT', type: 'interne', role: 'admin' } as Personne)
const STATUTS_DEMO = ['Présent', 'Présent', 'Télétravail', 'Présent', 'Pas encore pointé', 'Présent', 'Télétravail prévu', 'Absent', 'Présent',
  'Télétravail', 'Parti', 'Présent', 'Pas prévu (temps partiel)', 'Présent', 'En mission']

export type Persona = 'admin' | 'employe' | 'chef' | 'rh' | 'direction'

// Circuit des demandes entre les vues de la démo : une demande envoyée dans une vue arrive chez son
// valideur dans une autre vue, et la décision revient au demandeur (le changement de vue ne l'efface pas).
type Transmise = Demande & { de: Persona; vers: Persona | null }
const VALIDEUR: Record<Persona, Persona | null> = { employe: 'chef', chef: 'direction', rh: 'direction', admin: 'direction', direction: null }
const transmises: Transmise[] = []

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

// Pointages fictifs mais stables pour une autre personne (fiche de temps en démo)
function pointagesFictifs(personneId: string, debut: string, fin: string): Pointage[] {
  const r: Pointage[] = []
  const graine = [...personneId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  const auj = jourBxl()
  for (let j = debut; j <= fin && j < auj; j = decalerJour(j, 1)) {
    if (prevues(j) === 0) continue
    const h = (graine + Number(j.replace(/-/g, '')) * 2654435761) >>> 0
    if (h % 29 === 0) continue                                   // jour sans pointage
    const tt = h % 5 === 0
    const entree = 465 + (h % 45), sortie = entree + 486 + ((h >>> 3) % 40) - 20
    const ajout = (min: number, sens: Sens, k: string) => r.push({
      id: `${personneId}-${j}-${k}`, horodatage: isoBxl(j, min), jour: j, sens, type_code: tt ? 'TT' : 'BUREAU', source: 'web',
      lieu: tt ? 'externe' : 'reseau_cfb', remarque: null, annule: false, annule_motif: null, cree_le: isoBxl(j, min) })
    ajout(entree, 'entree', 'e')
    if (h % 23 !== 0) ajout(sortie, 'sortie', 's')               // de temps en temps : sortie oubliée
  }
  return r
}

export function calculerJournee(jour: string, pts: Pointage[], absence = 0): Journee {
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
  const p = prevues(jour), abs = Math.min(p, absence), aPrester = p - abs
  return {
    jour, prevues: p, absence: abs, a_prester: aPrester, nb_pointages: liste.length, brut, pause_deduite: pause,
    preste: brut - pause,
    // même règle que le serveur : jour non prévu → tout « à valider », pas de boni
    boni: liste.length === 0 || !complete || p === 0 ? 0 : Math.min(brut - pause, MAX_JOUR) - aPrester,
    depassement: !complete ? 0 : p === 0 ? brut - pause : Math.max(0, brut - pause - MAX_JOUR),
    complete,
  }
}

export function apiDemo(persona: Persona = 'employe'): Api {
  const aujourdhui = jourBxl()
  // Jour de télétravail habituel : mercredi pour l'employée, vendredi pour le chef (exemples)
  const base = { id: 'demo', type: 'interne' as const, regime: 'Temps plein 38h', minutes_jour: REGIME,
                 jours_teletravail: persona === 'employe' ? [3] : persona === 'chef' ? [5] : [] as number[] }
  const profil: Profil = persona === 'chef'
    ? { ...base, prenom: 'Marc', nom: 'Dupont', email: 'marc.dupont@cfb.test', role: 'employe', service: 'SAF', est_chef_service: true }
    : persona === 'admin'
    ? { ...base, prenom: 'Admin', nom: 'IT', email: 'admin.it@cfb.test', role: 'admin', service: 'IT', est_chef_service: false }
    : persona === 'direction'
    ? { ...base, prenom: 'Claire', nom: 'Lambert', email: 'claire.lambert@cfb.test', role: 'direction', service: 'Direction', est_chef_service: true }
    : persona === 'rh'
    ? { ...base, prenom: 'Nadia', nom: 'Benali', email: 'nadia.benali@cfb.test', role: 'rh', service: 'Ressources humaines', est_chef_service: false }
    : { ...base, prenom: 'Sofia', nom: 'Janssens', email: 'sofia.janssens@cfb.test', role: 'employe', service: 'SAF', est_chef_service: false }

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
    justificatif_requis: CODES.find((c) => c.code === s.code_absence)?.justificatif_requis ?? false, justificatif_joint: false, justificatif_chemin: null,
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
    // Maladie encodée par la RH : certificat à joindre (employée) / manquant (RH)
    { ...demande('demo', profil.prenom, profil.nom, { type: 'conge_jours', code_absence: 'MAL', debut: decalerJour(aujourdhui, -16), fin: decalerJour(aujourdhui, -15), demi: null, minutes: null }, 'accordee', decalerJour(aujourdhui, -16)), encode_par_rh: true },
    { ...demande('p5', 'Emma', 'Claes', { type: 'conge_jours', code_absence: 'AT', debut: decalerJour(aujourdhui, -9), fin: decalerJour(aujourdhui, -9), demi: null, minutes: null }, 'accordee', decalerJour(aujourdhui, -9)), encode_par_rh: true },
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
    ...PERSONNES.slice(13).filter((_, k) => k % 6 === 2).flatMap((p, k) => [j1, j2, j3, j5].slice(0, 1 + (k % 3)).map((jour, n) =>
      ({ personne_id: p.id, jour, code: (k + n) % 2 ? 'absent' : 'pointages_incomplets',
         libelle: (k + n) % 2 ? 'Absent sans justification' : 'Pointages incomplets (sortie manquante ?)' }) as AnomalieRH)),
  ]
  let heures: HeureAValider[] = [{ personne_id: 'p7', prenom: 'Emma', nom: 'Claes', jour: j2, minutes: 60 }]
  const clotures = new Set<string>(['2026-08-01'])
  // Écran Administration (démo)
  const sid = (nom: string) => `s-${nom}`
  let services: AdminService[] = (['Direction', 'SAF', 'ES / ISP', 'Ressources humaines', 'IT', 'Logistique', 'SIPP',
    'Compta', 'CEFOR', 'TS', 'Coordination'] as const).map((nom, i) => ({
    id: sid(nom), nom, parent_id: i === 0 ? null : sid('Direction'),
    couleur: ['#223A87', '#2479BE', '#A3C854', '#F7BC39', '#7A869A', '#5B6683', '#B23A33', '#2479BE', '#A3C854', '#F7BC39', '#223A87'][i],
    seuil_absence_pct: nom === 'SAF' ? 30 : 50, actif: true,
    chefs: nom === 'Direction' ? ['p0'] : nom === 'SAF' ? ['p1'] : [], effectif: 0 }))
  let regimes: Regime[] = [
    [1, 'Temps plein 38h', 'temps_plein', [456, 456, 456, 456, 456, 0, 0]], [2, 'Temps plein 37h30', 'temps_plein', [450, 450, 450, 450, 450, 0, 0]],
    [3, 'Temps partiel 36h (8h × 4 + 4h mer.)', 'temps_partiel', [480, 480, 240, 480, 480, 0, 0]],
    [4, 'Temps partiel 35h (8/5h30/8/8/5h30)', 'temps_partiel', [480, 330, 480, 480, 330, 0, 0]],
  ].map(([id, libelle, contrat, minutes_jour]) => ({ id, libelle, contrat, minutes_jour, actif: true, utilisations: 0,
    minutes_semaine: (minutes_jour as number[]).reduce((a, b) => a + b, 0) }) as Regime)
  let adminP: AdminPersonne[] = [...PERSONNES]
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
    ['ip_visible_n1', 1, 'booleen', 'Le N+1 voit l’adresse IP des pointages de son équipe'],
    ['stats_seuil_anonymat', 3, 'personnes', 'Regrouper les statistiques des services de moins de (0 = jamais)'],
    ['session_inactivite_min', 0, 'min', 'Déconnecter automatiquement après une inactivité de (0 = jamais)'],
    ['liaison_sso_seulement', 1, 'booleen', 'Lier un compte uniquement s’il se connecte via le fournisseur d’identité (Microsoft…), pas par e-mail + mot de passe'],
    ['conservation_ip_mois', 0, 'mois', 'Effacer l’adresse IP après (0 = aussi longtemps que les pointages)'],
    ['conservation_pointages_ans', 0, 'ans', 'Supprimer les pointages des mois clôturés après (0 = jamais)'],
    ['isp_conges', 1, 'booleen', 'Les ISP demandent leurs congés dans l’application'],
  ] as const).map(([cle, valeur, unite, libelle]) => ({ cle, valeur, unite, libelle, provisoire: !['ip_visible_n1', 'isp_conges', 'conservation_ip_mois', 'liaison_sso_seulement'].includes(cle),
      source: ['ip_visible_n1', 'isp_conges', 'conservation_ip_mois'].includes(cle) ? 'Décision CFB du 31/10/2026'
        : cle === 'liaison_sso_seulement' ? 'Audit du 31/10/2026 (R2)' : 'Valeur par défaut',
      categorie: cle.startsWith('rappel') || cle.startsWith('relance') ? 'Rappels' : cle.startsWith('conges') || cle === 'isp_conges' ? 'Congés'
        : cle.startsWith('conservation') ? 'Conservation' : ['liaison_sso_seulement', 'session_inactivite_min'].includes(cle) ? 'Sécurité' : ['ip_visible_n1', 'stats_seuil_anonymat'].includes(cle) ? 'Confidentialité' : 'Temps de travail' }))
  let compteurs: Compteur[] = ([
    ['CONGE_LEGAL', 'Congés annuels', 'annuelle', 'total', 'CONGE_N1'], ['CONGE_N1', 'Congés année passée', 'annuelle', 'total', 'CONGE_N2'],
    ['CONGE_N2', 'Congés année −2', 'annuelle', 'perdu', null], ['EXTRA_LEGAL', 'Congés extra-légaux', 'annuelle', 'total', null],
    ['ANCIENNETE', 'Congés ancienneté', 'annuelle', 'total', null], ['RECUP', 'Récup HS', 'trimestrielle', 'total', null],
    ['REPOS_COMP', 'Repos compensatoire', 'trimestrielle', 'total', null], ['BONI', 'Boni (horaire flottant)', 'aucune', 'total', null],
  ] as const).map(([code, libelle, periodicite, report_mode, report_vers], i) => ({ code, libelle, periodicite, report_mode, report_vers,
      report_plafond_min: null, visible_employe: true, autorise_negatif: true, ordre: i * 10, actif: true, regle_provisoire: true }))
  const rappels = new Set<string>()
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
  for (let i = 400; i >= 1; i--) {   // ~13 mois d’historique (fiche de temps), une sortie oubliée récente
    const j = decalerJour(aujourdhui, -i)
    if (prevues(j) === 0) continue
    const tt = i % 5 === 2
    ajouter(j, 480 + (i % 4) * 4, 'entree', tt ? 'TT' : 'BUREAU')
    if (i !== 3) ajouter(j, 968 + (i % 3) * 6, 'sortie', tt ? 'TT' : 'BUREAU')
  }

  const absenceDemo = (jour: string) => demandes.filter((d) => d.personne_id === 'demo' && d.statut === 'accordee' && d.date_debut <= jour && d.date_fin >= jour)
    .reduce((t, d) => t + (d.type === 'conge_heures' ? d.minutes_decomptees : d.type === 'conge_demi_jour' ? Math.floor(prevues(jour) / 2) : prevues(jour)), 0)
  // Jours de maladie de la personne de démo : pas de pointage ces jours-là
  for (const d of demandes.filter((x) => x.personne_id === 'demo' && x.code_absence === 'MAL')) {
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i].jour >= d.date_debut && pts[i].jour <= d.date_fin) pts.splice(i, 1)
  }

  // Présence du jour : les vraies personas gardent un statut connu, les figurants suivent une répartition réaliste
  const connus: Record<string, string> = { Marc: 'Présent', Yanis: 'Télétravail', Awa: 'Absent', Jordan: 'Pas encore pointé', Lucas: 'Présent',
    Emma: 'En formation', Nadia: 'Présent', Paul: 'En mission', Claire: 'Présent', Sofia: 'Pas encore pointé', Tom: 'Présent', Inès: 'Télétravail', Léa: 'Pas prévu (temps partiel)' }
  const voitMotif = persona !== 'employe'
  const presence: Presence[] = PERSONNES.map((p, i) => {
    let statut = (i < 13 ? connus[p.prenom] : undefined) ?? STATUTS_DEMO[(i * 7) % STATUTS_DEMO.length]
    if (statut === 'Absent' && voitMotif && i % 2) statut = 'Maladie'
    return { personne_id: p.id, prenom: p.prenom, nom: p.nom, service: p.service, mon_service: p.service === profil.service, statut,
             depuis: ['Présent', 'Télétravail'].includes(statut) ? isoBxl(aujourdhui, 470 + (i % 6) * 9) : null } as Presence
  })

  // Congés accordés / en attente des figurants (calendrier d'équipe)
  const congesEquipe: Demande[] = PERSONNES.slice(1).filter((p, k) => k % 3 === 1 && !['Sofia', 'Marc'].includes(p.prenom)).map((p, k) => {
    const debut = decalerJour(aujourdhui, (k * 3) % 24 - 2), fin = decalerJour(debut, k % 3 === 0 ? 4 : k % 3)
    return { id: `ce${k}`, numero: 900 + k, personne_id: p.id, prenom: p.prenom, nom: p.nom, type: 'conge_jours', code_absence: 'CP',
             libelle_absence: 'Congé annuel', date_debut: debut, date_fin: fin, demi: null, minutes_decomptees: 456 * 3, commentaire: null,
             statut: k % 5 === 2 ? 'en_attente' : 'accordee', decide_le: null, commentaire_decision: null, constate_le: null,
             encode_par_rh: false, cree_le: new Date().toISOString(), je_peux_valider: false } as Demande
  })

  const ilYa = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const n = (id: number, type: string, titre: string, corps: string, h: number, lu = false): Notif =>
    ({ id, type, titre, corps, lien: '/', cree_le: ilYa(h), lu_le: lu ? ilYa(h - 0.5) : null })
  const notifs: Notif[] = [
    n(1, 'fin_mois', '1 jour à régulariser avant la fin du mois', 'Corrige-le en 1 clic pour que la RH puisse clôturer.', 0.3),
    ...(persona === 'chef' || persona === 'direction' || persona === 'admin'
      ? [n(2, 'demande_a_traiter', 'Nouvelle demande de congé à valider', 'Yanis Peeters · Congé annuel · 3 jours', 2),
         n(3, 'correction_pointage', 'Correction de pointage dans ton équipe', 'Awa Diallo a ajouté une sortie oubliée (mardi).', 26, true),
         n(4, 'fin_mois_equipe', '3 personnes de ton équipe ont des jours à régulariser', 'Rappel envoyé automatiquement.', 50, true)] : []),
    n(5, 'demande_decidee', 'Ta demande de congé est accordée', 'Congé annuel du lundi au mercredi.', 27, true),
    n(6, 'oubli_sortie', 'Tu as oublié de pointer ta sortie ?', 'D’habitude tu pars vers 16h50.', 75, true),
    n(7, 'rappel_manuel', 'Rappel de la RH', 'Il te reste des pointages à régulariser avant la clôture du mois.', 24 * 9, true),
  ]

  const suivis = new Set<string>(['s-ES / ISP'])
  const teletravail = new Map<string, number[]>([['p2', [3]], ['p3', [2, 4]], ['p6', [1]]])
  const fichiers = new Map<string, string>()   // justificatifs déposés pendant la démo (restent dans le navigateur)
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
        type_code: d.type_code ?? (sens === 'sortie' && dernier ? dernier.type_code
          : profil.jours_teletravail?.includes(((new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7) + 1) ? 'TT' : 'BUREAU'),
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
    async journee(jour) { return calculerJournee(jour, pts, absenceDemo(jour)) },
    async soldeBoni() {
      // Depuis le début du trimestre (période de référence du boni)
      const m = Number(aujourdhui.slice(5, 7)), debut = `${aujourdhui.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, '0')}-01`
      let total = 0
      for (let j = debut; j < aujourdhui; j = decalerJour(j, 1)) total += calculerJournee(j, pts, absenceDemo(j)).boni
      return total
    },
    async anomalies() {
      const r: Anomalie[] = []
      for (let i = 1; i <= 62; i++) {   // même fenêtre que le serveur (2 mois)
        const j = decalerJour(aujourdhui, -i), jr = calculerJournee(j, pts, absenceDemo(j))
        if (jr.nb_pointages === 0 && jr.a_prester > 0) r.push({ jour: j, code: 'absent', libelle: 'Absent sans justification' })
        else if (jr.nb_pointages > 0 && !jr.complete) r.push({ jour: j, code: 'pointages_incomplets', libelle: 'Sortie manquante' })
      }
      return r
    },
    async presence() { return presence },
    async notifications() { return notifs },
    async marquerLu() { notifs.forEach((n) => { n.lu_le ??= new Date().toISOString() }) },
    async configPublique() { return { vapid_public: null, appli_url: null } },
    async enregistrerPush() { /* démo : rien n'est enregistré */ },
    async retirerPush() { /* démo */ },
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
      if (transmises.some((d) => d.de === persona && ['en_attente', 'accordee'].includes(d.statut)
                                 && d.date_debut <= s.fin && d.date_fin >= s.debut && (d.type === 'conge_jours' || s.type === 'conge_jours')))
        throw new Error('Tu as déjà une demande sur cette période')
      const nouvelle = demande('demo', profil.prenom, profil.nom, s, 'en_attente')
      if (VALIDEUR[persona]) transmises.push({ ...nouvelle, personne_id: `vue-${persona}`, de: persona, vers: VALIDEUR[persona] })
      else demandes.push(nouvelle)
    },
    async mesDemandes() {
      return [...demandes.filter((d) => d.personne_id === 'demo'), ...transmises.filter((d) => d.de === persona)]
        .sort((a, b) => b.date_debut.localeCompare(a.date_debut))
    },
    async aValider() {
      const recues = transmises.filter((d) => d.vers === persona && d.statut === 'en_attente').map((d) => ({ ...d, je_peux_valider: true }))
      return [...(['chef', 'admin', 'direction'].includes(persona) ? demandes.filter((d) => d.je_peux_valider && d.statut === 'en_attente') : []), ...recues]
    },
    async decider(ids, accorder, commentaire) {
      await attendre()
      if (!accorder && !commentaire?.trim()) throw new Error('Un refus doit être motivé')
      for (const d of [...demandes, ...transmises].filter((x) => ids.includes(x.id))) {
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
        services: (() => {
          const tous = [ligne('SAF', 30, 0.07 + (g % 3) / 100, 0.04, 0.05, 7), ligne('ES / ISP', 16, 0.06, 0.05, 0, 4),
            ligne('Direction', 1, 0.05, 0, 0.1, 0), ligne('Ressources humaines', 4, 0.06, 0.02, 0.25, 0), ligne('IT', 1, 0.05, 0, 0.4, 0),
            ligne('Logistique', 2, 0.08, 0.05, 0, 1), ligne('SIPP', 1, 0.04, 0, 0.2, 0), ligne('Compta', 3, 0.05, 0.01, 0.3, 0),
            ligne('CEFOR', 5, 0.06, 0.02, 0.2, 1), ligne('TS', 3, 0.07, 0.03, 0.1, 1), ligne('Coordination', 2, 0.05, 0, 0.3, 0)]
          const seuil = 3, petits = tous.filter((x) => x.effectif < seuil)
          const somme = (k: 'effectif' | 'prevues' | 'preste' | 'absence_conge' | 'absence_maladie' | 'absence_autre' | 'jours_presence' | 'jours_tt' | 'anomalies') =>
            petits.reduce((t, x) => t + x[k], 0)
          const eff = somme('effectif')
          return [...tous.filter((x) => x.effectif >= seuil), ...(petits.length ? [{
            service: `Petits services (moins de ${seuil} pers.)`, regroupe: true, effectif: eff, prevues: somme('prevues'), preste: somme('preste'),
            absence_conge: somme('absence_conge'), absence_maladie: eff < seuil ? null : somme('absence_maladie'),
            absence_autre: somme('absence_autre') + (eff < seuil ? somme('absence_maladie') : 0),
            jours_presence: somme('jours_presence'), jours_tt: somme('jours_tt'), anomalies: somme('anomalies') }] : [])]
        })(),
        seuil_anonymat: 3,
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
      return [['Kabongo', 'Jordan', 'ES / ISP', 9450, 8820, 450, 0, 1, 1], ['Mertens', 'Lina', 'ES / ISP', 9450, 9480, 0, 450, 0, 0],
              ['Haddad', 'Sami', 'ES / ISP', 9450, 8100, 900, 0, 2, 0]]
        .map(([nom, prenom, service, a, p, j, mal, nj, inc], i) => ({
          personne_id: `isp${i}`, prenom: prenom as string, nom: nom as string, partenaire: 'CPAS (fictif)', service: service as string,
          regime: 'Temps plein 37h30', a_prester: a as number - (j as number) - (mal as number), preste: p as number,
          conges: j as number, absence_justifiee: 0, absence_maladie: mal as number, jours_non_justifies: nj as number, jours_incomplets: inc as number,
          ecart: (p as number) - ((a as number) - (j as number) - (mal as number)) }))
    },
    async adminPersonnes() {
      exigerAdmin()
      return [...adminP].sort((a, b) => a.nom.localeCompare(b.nom))
    },
    async delierCompte(id) {
      exigerAdmin()
      if (id === 'p99' && persona === 'admin') throw new Error('Tu ne peux pas délier ton propre compte')
      adminP = adminP.map((x) => (x.id === id ? { ...x, compte_lie: false } : x))
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
    async envoyerRappel(ids) {
      await attendre()
      const nouveaux = ids.filter((id) => !rappels.has(id)); nouveaux.forEach((id) => rappels.add(id)); return nouveaux.length
    },
    async deposerJustificatif(d, fichier) {
      await attendre()
      const cible = [...demandes, ...congesEquipe].find((x) => x.id === d.id)
      if (!cible) throw new Error('Demande introuvable')
      const chemin = `demo/${d.id}/${fichier.name}`
      fichiers.set(chemin, URL.createObjectURL(fichier))
      Object.assign(cible, { justificatif_joint: true, justificatif_chemin: chemin })
    },
    async justificatifsManquants() {
      return [...demandes, ...congesEquipe].filter((d) => d.statut === 'accordee' && d.justificatif_requis && !d.justificatif_joint)
    },
    async lienJustificatif(chemin) { return fichiers.get(chemin) ?? 'about:blank' },
    async retirerJustificatif(d) {
      const cible = [...demandes, ...congesEquipe].find((x) => x.id === d.id)
      if (cible) Object.assign(cible, { justificatif_joint: false, justificatif_chemin: null })
    },
    async teletravailDe(personneId) {
      const jours = personneId === profil.id ? profil.jours_teletravail ?? [] : teletravail.get(personneId) ?? []
      return { jours, modifiable: ['chef', 'rh', 'admin', 'direction'].includes(persona) && personneId !== profil.id }
    },
    async definirTeletravail(personneId, jours) {
      if (!['chef', 'rh', 'admin', 'direction'].includes(persona)) throw new Error('Seuls la RH, l’admin ou le responsable peuvent définir les jours de télétravail')
      teletravail.set(personneId, [...new Set(jours)].sort())
    },
    async servicesSuivis() {
      if (!['direction', 'admin'].includes(persona)) throw new Error('Action réservée à : direction, admin')
      return services.map((x) => ({ service_id: x.id, nom: x.nom, suivi: suivis.has(x.id),
        effectif: PERSONNES.filter((p) => p.service === x.nom).length, chef_absent_aujourdhui: false }))
        .sort((a, b) => a.nom.localeCompare(b.nom))
    },
    async suivreService(serviceId, suivre) { if (suivre) suivis.add(serviceId); else suivis.delete(serviceId) },
    async journeesPersonne(personneId, debut, fin) {
      const liste = personneId === profil.id ? pts : pointagesFictifs(personneId, debut, fin)
      const r: Journee[] = []
      for (let j = debut; j <= fin && j < aujourdhui; j = decalerJour(j, 1)) r.push(calculerJournee(j, liste, personneId === profil.id ? absenceDemo(j) : 0))
      return r
    },
    async pointagesPersonne(personneId, debut, fin) {
      return (personneId === profil.id ? pts : pointagesFictifs(personneId, debut, fin)).filter((p) => p.jour >= debut && p.jour <= fin)
    },
    async absencesPersonne(personneId, debut, fin) {
      return [...demandes, ...congesEquipe].filter((d) => d.statut === 'accordee' && d.date_debut <= fin && d.date_fin >= debut
        && (personneId === profil.id ? d.personne_id === profil.id || d.prenom === profil.prenom : d.personne_id === personneId))
    },
    async personnesVisibles(): Promise<PersonneVisible[]> {
      if (persona === 'employe') return [{ id: 'demo', prenom: profil.prenom, nom: profil.nom, service: profil.service }]
      return PERSONNES.filter((p) => persona !== 'chef' || p.service === profil.service).map(({ id, prenom, nom, service }) => ({ id, prenom, nom, service }))
    },
    async demandesEquipe(debut, fin) {
      return [...demandes, ...congesEquipe].filter((d) => ['en_attente', 'accordee'].includes(d.statut) && d.date_debut <= fin && d.date_fin >= debut)
        .map((d) => ({ ...d, personne_id: PERSONNES.find((p) => p.prenom === d.prenom)?.id ?? d.personne_id }))
    },
    async compteurs() { return compteurs },
    async enregistrerCompteur(c) {
      exigerAdmin()
      if (c.report_mode === 'plafonne' && c.report_plafond_min == null) throw new Error('Indique le plafond de report')
      compteurs = compteurs.map((x) => (x.code === c.code ? { ...c, regle_provisoire: false } : x))
    },
    async deconnexion() { /* rien */ },
  }
}
