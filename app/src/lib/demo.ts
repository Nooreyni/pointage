// Mode démo : données FICTIVES en mémoire, sans serveur (présentation et tests d'interface).
// Les règles de calcul reprennent celles du serveur (pause 30 min au-delà de 6 h, plafond 9 h).
import type { Acces, AdminPersonne, AdminService, Compteur, Ferie, Parametre, PersonneVisible, Regime, Reseau } from './types'
import type { Anomalie, AnomalieRH, Api, CodeAbsence, Demande, EtatCloture, HeureAValider, Journee, Notif, Personne, Pointage, Presence,
  ApercuDepart, LigneCpas, LigneMensuelle, Modification, MouvementCompteur, LigneTeletravail, Profil, SaisieDemande, Sens, Simulation, StatsDirection } from './types'
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
// SAF ≈ 30 personnes (le plus grand service), RH = 3 RH + 1 admin RH. 14 ISP (article 60) rattachés à leurs services
// (pas un service à part ; « ES/ISP » n'est qu'un groupe de filtre dans Dinclock),
// Direction, IT (1 personne), Logistique et SIPP (services sans équipe), Compta, CEFOR, TS, Coordination.
// Effectifs de Compta, CEFOR, TS et Coordination : estimés (total 68 = comptes Dinclock), à corriger.
const PERSONNES: Personne[] = ([
  ['Lambert', 'Claire', 'Direction', 'direction'], ['Dupont', 'Marc', 'SAF', 'employe'],
  ['Janssens', 'Sofia', 'SAF', 'employe'], ['Peeters', 'Yanis', 'SAF', 'employe'],
  ['Diallo', 'Awa', 'SAF', 'employe'], ['Kabongo', 'Jordan', 'SAF', 'employe'],
  ['Martin', 'Lucas', 'SAF', 'employe'], ['Claes', 'Emma', 'CEFOR', 'employe'], ['Benali', 'Nadia', 'Ressources humaines', 'rh'],
  ['Wouters', 'Tom', 'Ressources humaines', 'rh'], ['Leroy', 'Inès', 'Ressources humaines', 'admin_rh'],
  ['Simon', 'Léa', 'Ressources humaines', 'rh'], ['Renard', 'Paul', 'Logistique', 'employe'],
] as const).map(([nom, prenom, service, role], i) =>
  ({ id: `p${i}`, nom, prenom, service, role, type: prenom === 'Jordan' ? 'isp' : 'interne' }) as Personne)

// Figurants pour atteindre l'effectif de chaque service (noms fictifs, générés)
const PRENOMS = ['Amine', 'Julie', 'Kevin', 'Sarah', 'Mehdi', 'Laura', 'Thomas', 'Fatima', 'Nicolas', 'Chloé', 'Youssef', 'Manon', 'Antoine',
  'Aïcha', 'Maxime', 'Camille', 'Ibrahim', 'Elise', 'Hugo', 'Mariam', 'Simon', 'Noor', 'Arthur', 'Zoé', 'Bilal', 'Margaux', 'Jonas', 'Salma']
const NOMS = ['Mertens', 'Willems', 'El Amrani', 'Goossens', 'Lemaire', 'Nkosi', 'Dubois', 'Maes', 'Bakkali', 'Hermans', 'Lefèvre', 'Jacobs',
  'Mbaye', 'Vermeulen', 'Collin', 'Aydin', 'Michel', 'Desmet', 'Ouali', 'Pirlot', 'Lambrecht', 'Moreau', 'Ndiaye', 'Smets', 'Gilson', 'Rahmani']
// Figurants par service et, parmi eux, combien d'ISP (14 ISP au total avec Jordan, au SAF). Effectifs fictifs.
const REPARTITION: [string, number, number][] = [['SAF', 31, 5], ['Logistique', 3, 2], ['SIPP', 1, 0],
  ['Compta', 3, 0], ['CEFOR', 9, 4], ['TS', 5, 2], ['Coordination', 2, 0]]
let rang = 0
for (const [service, n, isp] of REPARTITION) for (let k = 0; k < n; k++, rang++) {
  PERSONNES.push({ id: `p${13 + rang}`, prenom: PRENOMS[(rang * 5 + 1) % PRENOMS.length], nom: NOMS[(rang * 11 + 3) % NOMS.length], service,
                   role: 'employe', type: k >= n - isp ? 'isp' : 'interne' } as Personne)
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
    // Congé déjà accordé dans 2 semaines (exemple visible dans l'agenda et « Mes prochains congés »)
    demande('demo', profil.prenom, profil.nom, { type: 'conge_jours', code_absence: 'CP', debut: lundi(2), fin: decalerJour(lundi(2), 3), demi: null, minutes: null }, 'accordee', decalerJour(aujourdhui, -5)),
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
  let services: AdminService[] = (['Direction', 'SAF', 'Ressources humaines', 'IT', 'Logistique', 'SIPP',
    'Compta', 'CEFOR', 'TS', 'Coordination'] as const).map((nom, i) => ({
    id: sid(nom), nom, parent_id: i === 0 ? null : sid('Direction'),
    couleur: ['#223A87', '#2479BE', '#F7BC39', '#7A869A', '#5B6683', '#B23A33', '#2479BE', '#A3C854', '#F7BC39', '#223A87'][i],
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
  let parametres: Parametre[] = (([
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
      categorie: cle.startsWith('rappel') || cle.startsWith('relance') ? 'Rappels' : cle.startsWith('conges') || cle === 'isp_conges' ? 'Congés et absences'
        : cle.startsWith('conservation') ? 'Conservation' : ['liaison_sso_seulement', 'session_inactivite_min'].includes(cle) ? 'Sécurité' : ['ip_visible_n1', 'stats_seuil_anonymat'].includes(cle) ? 'Confidentialité' : 'Temps de travail' }))) as Parametre[]
  parametres = [...parametres,
    { cle: 'justificatifs_actifs', valeur: 0, unite: 'booleen', libelle: 'Demander des justificatifs (certificats…)', provisoire: true, source: null, categorie: 'Congés et absences', ordre: 10,
      aide: 'Coupé : aucun justificatif n’est demandé ni signalé comme manquant.' },
    { cle: 'justificatif_visible_n1', valeur: 0, unite: 'booleen', libelle: 'Le N+1 peut ouvrir les justificatifs de son équipe', provisoire: true, source: null, categorie: 'Congés et absences', parent: 'justificatifs_actifs', ordre: 11 },
    { cle: 'anonymisation_depart_ans', valeur: 5, unite: 'ans', libelle: 'Anonymiser les personnes parties après (0 = jamais)', provisoire: true, source: null, categorie: 'Conservation', ordre: 20,
      aide: 'Nom, e-mail et matricule effacés ; heures et absences gardées pour les statistiques.' },
    { cle: 'mfa_admin_rh', valeur: 0, unite: 'booleen', libelle: 'Double authentification pour admin et RH', provisoire: false, source: 'Décision CFB du 02/11/2026 : pas pour le moment', categorie: 'Sécurité', ordre: 5,
      aide: 'Activée : ces comptes confirment leur connexion avec un code sur leur téléphone (application d’authentification).' },
    { cle: 'indemnite_tt_active', valeur: 1, unite: 'booleen', libelle: 'Indemnité de télétravail', provisoire: true, source: null, categorie: 'Télétravail', ordre: 10,
      aide: 'Calculée dans Rapports › Télétravail, à partir des jours pointés en télétravail.' },
    { cle: 'indemnite_tt_montant', valeur: 2500, unite: 'centimes', libelle: 'Indemnité de télétravail (montant € HT)', provisoire: true, source: null, categorie: 'Télétravail', parent: 'indemnite_tt_active', ordre: 11 },
    { cle: 'indemnite_tt_forfait_mensuel', valeur: 0, unite: 'booleen', libelle: 'Mode de calcul', provisoire: true, source: null, categorie: 'Télétravail', parent: 'indemnite_tt_active', ordre: 12,
      options: ['Par jour de télétravail', 'Forfait par mois'] },
    { cle: 'indemnite_tt_plafond', valeur: 0, unite: 'centimes', libelle: 'Plafond mensuel de l’indemnité (0 = sans plafond)', provisoire: true, source: null, categorie: 'Télétravail', parent: 'indemnite_tt_active', ordre: 13 },
  ]
  const param = (cle: string) => parametres.find((p) => p.cle === cle)?.valeur ?? 0
  const indemnite = (jours: number) => {
    if (jours <= 0 || !param('indemnite_tt_active')) return 0
    const brut = param('indemnite_tt_forfait_mensuel') ? param('indemnite_tt_montant') : param('indemnite_tt_montant') * jours
    return param('indemnite_tt_plafond') > 0 ? Math.min(brut, param('indemnite_tt_plafond')) : brut
  }
  // Justificatifs coupés : rien n'est « requis »
  // Compteurs par personne (démo) : ouverture de l'année + ajustements
  const ILYA = (j: number) => decalerJour(aujourdhui, -j)
  const mouvements = new Map<string, MouvementCompteur[]>()
  let idMvt = 1
  const mvts = (personneId: string): MouvementCompteur[] => {
    if (!mouvements.has(personneId)) {
      const an = aujourdhui.slice(0, 4)
      mouvements.set(personneId, [
        { id: idMvt++, compteur_code: 'CONGE_LEGAL', compteur: 'Congés annuels', date_effet: `${an}-01-01`, type: 'attribution', minutes: 9120, motif: `Congés annuels ${an}`, par: 'Nadia Benali', cree_le: `${an}-01-02T09:00:00Z` },
        { id: idMvt++, compteur_code: 'CONGE_LEGAL', compteur: 'Congés annuels', date_effet: ILYA(60), type: 'prise', minutes: -2280, motif: 'Congés payés (5 j)', par: 'Calcul automatique', cree_le: `${ILYA(60)}T10:00:00Z` },
        { id: idMvt++, compteur_code: 'EXTRA_LEGAL', compteur: 'Congés extra-légaux', date_effet: `${an}-01-01`, type: 'attribution', minutes: 912, motif: `Extra-légaux ${an}`, par: 'Nadia Benali', cree_le: `${an}-01-02T09:00:00Z` },
        { id: idMvt++, compteur_code: 'RECUP', compteur: 'Récup HS', date_effet: ILYA(20), type: 'hs_validees', minutes: 220, motif: 'Heures accordées en récup', par: 'Marc Dupont', cree_le: `${ILYA(20)}T15:00:00Z` },
      ])
    }
    return mouvements.get(personneId)!
  }
  const journalDemo: Modification[] = [
    { id: 3, quand: new Date(Date.now() - 3600e3).toISOString(), qui: 'Inès Leroy', objet: 'parametres', action: 'UPDATE', champs: ['provisoire', 'source', 'valeur'], avant: { cle: 'pause_seuil_min', valeur: 360 }, apres: { cle: 'pause_seuil_min', valeur: 360, provisoire: false } },
    { id: 2, quand: new Date(Date.now() - 26 * 3600e3).toISOString(), qui: 'Admin IT', objet: 'personnes', action: 'INSERT', champs: ['nom', 'prenom', 'email', 'service_id'], avant: null, apres: { prenom: 'Laura', nom: 'Nkosi' } },
    { id: 1, quand: new Date(Date.now() - 50 * 3600e3).toISOString(), qui: 'Marc Dupont', objet: 'demandes', action: 'UPDATE', champs: ['statut', 'decide_le', 'decide_par'], avant: { statut: 'en_attente' }, apres: { statut: 'accordee' } },
  ]
  const journaliser = (objet: string, action: Modification['action'], champs: string[], apres: Record<string, unknown> | null = null) =>
    journalDemo.unshift({ id: journalDemo.length + 1, quand: new Date().toISOString(), qui: `${profil.prenom} ${profil.nom}`, objet, action, champs, avant: null, apres })
  const justif = (d: Demande): Demande => ({ ...d, justificatif_requis: !!d.justificatif_requis && param('justificatifs_actifs') === 1 })
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
    if (!(profil.role === 'admin' || (rh && (profil.role === 'admin_rh' || profil.role === 'direction')))) throw new Error('Action réservée à l’admin général')
  }
  // Fiches des personnes : admin, admin RH et RH (la RH ne gère pas les admins)
  const exigerGestion = () => { if (!['admin', 'admin_rh', 'rh', 'direction'].includes(profil.role)) throw new Error('Action réservée à la RH') }
  const peutGererRole = (r: string) => profil.role === 'admin' || ((profil.role === 'admin_rh' || profil.role === 'direction') && r !== 'admin') || (profil.role === 'rh' && !['admin', 'admin_rh'].includes(r))

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
             statut: k % 5 === 2 ? 'en_attente' : k % 7 === 4 ? 'refusee' : 'accordee',
             decide_le: k % 5 === 2 ? null : new Date(Date.now() - (k + 1) * 2 * 86_400_000).toISOString(), decide_par: 'p1',
             commentaire_decision: k % 7 === 4 ? 'Trop d’absences dans le service cette semaine-là' : null, constate_le: null,
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

  const suivis = new Set<string>(['s-CEFOR'])
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
        .sort((a, b) => b.date_debut.localeCompare(a.date_debut)).map(justif)
    },
    async aValider() {
      const recues = transmises.filter((d) => d.vers === persona && d.statut === 'en_attente').map((d) => ({ ...d, je_peux_valider: true }))
      return [...(['chef', 'admin', 'direction'].includes(persona) ? demandes.filter((d) => d.je_peux_valider && d.statut === 'en_attente') : []), ...recues].map(justif)
    },
    async erreursRecentes() { return [] },
    async decisionsRecentes() {
      return [...demandes, ...transmises, ...congesEquipe].filter((d) => ['accordee', 'refusee'].includes(d.statut) && d.decide_le && d.personne_id !== 'demo')
        .sort((a, b) => (b.decide_le ?? '').localeCompare(a.decide_le ?? ''))
    },
    async decider(ids, accorder, commentaire) {
      await attendre()
      if (!accorder && !commentaire?.trim()) throw new Error('Un refus doit être motivé')
      for (const d of [...demandes, ...transmises].filter((x) => ids.includes(x.id))) {
        d.statut = accorder ? 'accordee' : 'refusee'; d.decide_le = new Date().toISOString(); d.decide_par = profil.id; d.commentaire_decision = commentaire ?? null
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
    async aConstater() { return demandes.filter((d) => d.statut === 'accordee' && !d.constate_le && d.personne_id !== 'demo').map(justif) },
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
    async attribuerConges(_annee, personnes) { await attendre(); return personnes?.length ?? PERSONNES.length },
    async soldesPersonne(personneId) {
      const par = new Map<string, { libelle: string; attribue: number; pris: number; reste: number }>()
      for (const m of mvts(personneId)) {
        const x = par.get(m.compteur_code) ?? { libelle: m.compteur, attribue: 0, pris: 0, reste: 0 }
        if (m.minutes >= 0 && m.type !== 'prise') x.attribue += m.minutes; else x.pris -= m.minutes
        x.reste += m.minutes; par.set(m.compteur_code, x)
      }
      return [...par].map(([code, x], i) => ({ compteur_code: code, libelle: x.libelle, ordre: i, periode_debut: `${aujourdhui.slice(0, 4)}-01-01`, attribue_min: x.attribue, pris_min: x.pris, reste_min: x.reste }))
    },
    async mouvementsPersonne(personneId) { return [...mvts(personneId)].sort((a, b) => b.date_effet.localeCompare(a.date_effet) || b.id - a.id) },
    async ajusterSolde(personneId, compteur, minutes, motif) {
      if (!['rh', 'admin', 'direction'].includes(persona)) throw new Error('Action réservée à : rh, admin_rh, admin')
      if (!motif.trim()) throw new Error('Un ajustement doit être motivé')
      const libelle = mvts(personneId).find((m) => m.compteur_code === compteur)?.compteur ?? compteur
      mvts(personneId).push({ id: idMvt++, compteur_code: compteur, compteur: libelle, date_effet: aujourdhui, type: 'ajustement', minutes, motif, par: `${profil.prenom} ${profil.nom}`, cree_le: new Date().toISOString() })
      journaliser('mouvements_compteur', 'INSERT', ['compteur_code', 'minutes', 'motif'])
    },
    async reprendreSolde(personneId, compteur, minutes, dateEffet, motif) {
      if (!['rh', 'admin', 'direction'].includes(persona)) throw new Error('Action réservée à : rh, admin_rh, admin')
      const libelle = compteurs.find((c) => c.code === compteur)?.libelle ?? compteur
      mvts(personneId).push({ id: idMvt++, compteur_code: compteur, compteur: libelle, date_effet: dateEffet, type: 'ouverture', minutes, motif, par: `${profil.prenom} ${profil.nom}`, cree_le: new Date().toISOString() })
      journaliser('mouvements_compteur', 'INSERT', ['compteur_code', 'minutes', 'motif'])
    },
    async preparerDepart(personneId): Promise<ApercuDepart> {
      const soldes = await this.soldesPersonne(personneId)
      const x = adminP.find((a) => a.id === personneId)
      return { soldes: soldes.filter((s) => s.reste_min !== 0).map((s) => ({ compteur: s.libelle, reste_min: s.reste_min })),
               demandes_apres: demandes.filter((d) => d.prenom === x?.prenom && ['en_attente', 'accordee'].includes(d.statut) && d.date_debut > aujourdhui).length,
               chef_de: x?.prenom === 'Marc' ? ['SAF'] : [], acces_delegues: 0, demandes_a_valider: x?.prenom === 'Marc' ? 3 : 0 }
    },
    async enregistrerDepart(personneId, date) {
      exigerAdmin(); await attendre()
      adminP = adminP.map((a) => (a.id === personneId ? { ...a, date_sortie: date } : a))
      journaliser('personnes', 'UPDATE', ['date_sortie'], { date_sortie: date })
      return { demandes_annulees: 0 }
    },
    async annulerDepart(personneId) {
      exigerAdmin(); adminP = adminP.map((a) => (a.id === personneId ? { ...a, date_sortie: null } : a))
      journaliser('personnes', 'UPDATE', ['date_sortie'], { date_sortie: null })
    },
    async journal(limite = 200, objet = null) {
      exigerAdmin()
      return journalDemo.filter((j) => !objet || j.objet === objet).slice(0, limite)
    },
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
          const tous = [ligne('SAF', 37, 0.07 + (g % 3) / 100, 0.045, 0.04, 9),
            ligne('Direction', 1, 0.05, 0, 0.1, 0), ligne('Ressources humaines', 4, 0.06, 0.02, 0.25, 0), ligne('IT', 1, 0.05, 0, 0.4, 0),
            ligne('Logistique', 4, 0.08, 0.05, 0, 2), ligne('SIPP', 1, 0.04, 0, 0.2, 0), ligne('Compta', 3, 0.05, 0.01, 0.3, 0),
            ligne('CEFOR', 10, 0.06, 0.03, 0.15, 2), ligne('TS', 5, 0.07, 0.03, 0.1, 1), ligne('Coordination', 2, 0.05, 0, 0.3, 0)]
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
      return [['Kabongo', 'Jordan', 'SAF', 9450, 8820, 450, 0, 1, 1], ['Mertens', 'Lina', 'CEFOR', 9450, 9480, 0, 450, 0, 0],
              ['Haddad', 'Sami', 'TS', 9450, 8100, 900, 0, 2, 0]]
        .map(([nom, prenom, service, a, p, j, mal, nj, inc], i) => ({
          personne_id: `isp${i}`, prenom: prenom as string, nom: nom as string, partenaire: 'CPAS (fictif)', service: service as string,
          regime: 'Temps plein 37h30', a_prester: a as number - (j as number) - (mal as number), preste: p as number,
          conges: j as number, absence_justifiee: 0, absence_maladie: mal as number, jours_non_justifies: nj as number, jours_incomplets: inc as number,
          ecart: (p as number) - ((a as number) - (j as number) - (mal as number)) }))
    },
    async rapportMensuel(mois): Promise<LigneMensuelle[]> {
      if (persona === 'employe') return []
      await attendre()
      const fin = (() => { const d = new Date(`${mois}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) })()
      const veille = decalerJour(aujourdhui, -1), borne = fin < veille ? fin : veille
      let ouvrables = 0
      for (let j = mois; j <= borne; j = decalerJour(j, 1)) { const d = new Date(`${j}T12:00:00Z`).getUTCDay(); if (d > 0 && d < 6 && !feries.some((f) => f.jour === j)) ouvrables++ }
      return PERSONNES.filter((x) => x.id !== 'p99' && (persona !== 'chef' || x.service === profil.service) && !(persona === 'chef' && x.prenom === profil.prenom))
        .map((x, i) => {
          const lim = (n: number) => Math.min(n, Math.floor(ouvrables / 3))
          const conges = lim(i % 7 === 2 ? 3 : i % 11 === 4 ? 1 : 0), maladie = lim(i % 13 === 5 ? 2 : 0), nj = lim(i % 9 === 3 ? 1 : 0), inc = lim(i % 8 === 6 ? 1 : 0)
          const tt = (teletravail.get(x.id)?.length ?? (i % 3 === 0 ? 1 : 0)) * Math.round(ouvrables / 5)
          const prevus = ouvrables, presents = Math.max(0, prevus - conges - maladie - nj)
          const aPrester = (prevus - conges - maladie) * 456, preste = prevus ? Math.max(0, aPrester - nj * 456 + ((i * 37) % 90) - 30) : 0
          return { personne_id: x.id, prenom: x.prenom, nom: x.nom, service: x.service, regime: 'Temps plein 38h', jours_prevus: prevus, jours_presents: presents,
                   jours_tt: Math.min(tt, presents), a_prester: aPrester, preste, boni: preste - aPrester, conges: conges * 456, maladie: maladie * 456,
                   autres_absences: 0, jours_non_justifies: nj, jours_incomplets: inc }
        }).sort((a, b) => a.service.localeCompare(b.service) || a.nom.localeCompare(b.nom))
    },
    async rapportTeletravail(mois): Promise<LigneTeletravail[]> {
      if (!['rh', 'admin', 'direction'].includes(persona)) throw new Error('Action réservée à : rh, admin_rh, direction, admin')
      await attendre()
      const fin = (() => { const d = new Date(`${mois}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) })()
      const isodow = (j: string) => ((new Date(`${j}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
      return PERSONNES.map((x, i) => ({ x, jours: teletravail.get(x.id) ?? (i % 3 === 0 ? [((i % 5) + 1)] : []) }))
        .filter(({ jours }) => jours.length > 0)
        .map(({ x, jours }, k) => {
          const dates: string[] = []
          for (let j = mois; j <= fin && j <= aujourdhui; j = decalerJour(j, 1)) if (jours.includes(isodow(j)) && !feries.some((f) => f.jour === j)) dates.push(j)
          // Exemple : une personne sur quatre a aussi télétravaillé un autre jour (exceptionnel)
          if (k % 4 === 1) { const extra = decalerJour(mois, 8); if (extra <= aujourdhui && isodow(extra) < 6 && !dates.includes(extra)) dates.push(extra) }
          dates.sort()
          return { personne_id: x.id, prenom: x.prenom, nom: x.nom, service: x.service, jours_tt: dates.length, dates, jours_habituels: jours, indemnite_centimes: indemnite(dates.length) }
        })
        .sort((a, b) => a.service.localeCompare(b.service) || a.nom.localeCompare(b.nom))
    },
    async genererMotDePasse(personneId) {
      if (!['rh', 'admin'].includes(persona)) throw new Error('Action réservée à : rh, admin_rh, admin')
      if (personneId === 'p99' && persona !== 'admin') throw new Error('Seul un admin général peut gérer le mot de passe d’un admin général')
      await attendre()
      const x = adminP.find((a) => a.id === personneId)
      const cree = !x?.compte_lie
      adminP = adminP.map((a) => (a.id === personneId ? { ...a, compte_lie: true } : a))
      const A = 'abcdefghjkmnpqrstuvwxyz23456789', o = crypto.getRandomValues(new Uint8Array(12))
      const c = [...o].map((v) => A[v % A.length]).join('')
      return { email: x?.email ?? 'personne@cfb.test', nom: x ? `${x.prenom} ${x.nom}` : 'Personne', mot_de_passe: `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`, cree }
    },
    async connexion() { return { motDePasse: true, microsoft: false } },
    async lienAgenda() { return 'https://exemple-cfb.supabase.co/functions/v1/agenda?jeton=lien-de-demonstration' },
    async mfaEtat() { return { facteurs: [], niveau: 'aal1' as const, requisPossible: false } },
    async mfaInscrire(): Promise<{ id: string; qr: string; secret: string }> { throw new Error('Non disponible en démo') },
    async mfaVerifier() { throw new Error('Non disponible en démo') },
    async mfaRetirer() { /* démo */ },
    async changerMotDePasse(actuel, nouveau) {
      await attendre()
      if (!actuel) throw new Error('Mot de passe actuel incorrect')
      if (actuel === nouveau) throw new Error('Le nouveau mot de passe doit être différent de l’actuel')
    },
    async adminPersonnes() {
      exigerGestion()
      return [...adminP].sort((a, b) => a.nom.localeCompare(b.nom))
    },
    async delierCompte(id) {
      exigerAdmin()
      if (id === 'p99' && persona === 'admin') throw new Error('Tu ne peux pas délier ton propre compte')
      adminP = adminP.map((x) => (x.id === id ? { ...x, compte_lie: false } : x))
    },
    async enregistrerPersonne(s) {
      exigerGestion(); await attendre()
      if (!s.prenom.trim() || !s.nom.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) throw new Error('Prénom, nom et e-mail valide obligatoires')
      const ancien = adminP.find((p) => p.id === s.id)
      if (ancien && !peutGererRole(ancien.role)) throw new Error(`Seul un ${ancien.role === 'admin' ? 'admin général' : 'admin RH ou admin général'} peut modifier cette personne`)
      if (!peutGererRole(s.role)) throw new Error(`Seul un ${s.role === 'admin' ? 'admin général' : 'admin RH ou admin général'} peut attribuer ce rôle`)
      if (!ancien && adminP.some((p) => p.email === s.email.trim().toLowerCase())) throw new Error('Cette adresse e-mail est déjà utilisée par une autre fiche')
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
    async regimePersonnalise(personneId, minutesJour, debut) {
      exigerGestion()
      if (!minutesJour.some((m) => m > 0)) throw new Error('Choisis au moins un jour travaillé')
      let r = regimes.find((x) => x.actif && x.minutes_jour.join() === minutesJour.join())
      if (!r) {
        const noms = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'], n = minutesJour.filter((m) => m > 0).length, tot = minutesJour.reduce((a, b) => a + b, 0)
        const plein = tot >= 2280
        r = { id: Math.max(...regimes.map((x) => x.id)) + 1, libelle: `${plein ? 'Temps plein' : `${n}/5`} · ${noms.filter((_, i) => minutesJour[i] > 0).join(' ')} (${Math.floor(tot / 60)}h${String(tot % 60).padStart(2, '0')}/sem.)`,
              contrat: plein ? 'temps_plein' : 'temps_partiel', minutes_jour: minutesJour, actif: true, utilisations: 0, minutes_semaine: tot } as Regime
        regimes = [...regimes, r]
      }
      await this.changerRegime(personneId, r.id, debut)
      return r.id
    },
    async changerRegime(personneId, regimeId, debut) {
      exigerGestion(); await attendre()
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
    async donnerAcces(personneId, serviceId, peutValider, jusquAu = null) {
      if (jusquAu && jusquAu < aujourdhui) throw new Error('La date de fin est déjà passée')
      const p = adminP.find((x) => x.id === personneId)!, s = services.find((x) => x.id === serviceId)!
      acces = [...acces.filter((a) => !(a.personne_id === personneId && a.service_id === serviceId)),
               { personne_id: personneId, prenom: p.prenom, nom: p.nom, service_id: serviceId, service: s.nom, peut_valider: peutValider, jusqu_au: jusquAu, actif: true }]
    },
    async retirerAcces(personneId, serviceId) { acces = acces.filter((a) => !(a.personne_id === personneId && a.service_id === serviceId)) },
    async parametres() { return parametres },
    async modifierParametre(cle, valeur, source) {
      exigerAdmin()
      if (!source.trim()) throw new Error('Indique la source (ex. règlement de travail art. X)')
      parametres = parametres.map((p) => (p.cle === cle ? { ...p, valeur, source, provisoire: false } : p))
      journaliser('parametres', 'UPDATE', ['valeur', 'provisoire', 'source'], { cle, valeur })
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
      return [...demandes, ...congesEquipe].map(justif).filter((d) => d.statut === 'accordee' && d.justificatif_requis && !d.justificatif_joint)
    },
    async lienJustificatif(chemin) { return fichiers.get(chemin) ?? 'about:blank' },
    async retirerJustificatif(d) {
      const cible = [...demandes, ...congesEquipe].find((x) => x.id === d.id)
      if (cible) Object.assign(cible, { justificatif_joint: false, justificatif_chemin: null })
    },
    async teletravailDe(personneId) {
      const jours = personneId === profil.id ? profil.jours_teletravail ?? [] : teletravail.get(personneId) ?? []
      return { jours, modifiable: personneId === profil.id || ['chef', 'rh', 'admin', 'direction'].includes(persona) }
    },
    async definirTeletravail(personneId, jours) {
      if (personneId !== profil.id && !['chef', 'rh', 'admin', 'direction'].includes(persona)) {
        throw new Error('Tu ne peux pas modifier les jours de télétravail de cette personne')
      }
      const tri = [...new Set(jours)].sort()
      if (personneId === profil.id) profil.jours_teletravail = tri
      else teletravail.set(personneId, tri)
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
        && (personneId === profil.id ? d.personne_id === profil.id || d.prenom === profil.prenom : d.personne_id === personneId)).map(justif)
    },
    async personnesVisibles(): Promise<PersonneVisible[]> {
      if (persona === 'employe') return [{ id: 'demo', prenom: profil.prenom, nom: profil.nom, service: profil.service }]
      return PERSONNES.filter((p) => persona !== 'chef' || p.service === profil.service).map(({ id, prenom, nom, service }) => ({ id, prenom, nom, service }))
    },
    async demandesEquipe(debut, fin) {
      return [...demandes, ...congesEquipe].filter((d) => ['en_attente', 'accordee'].includes(d.statut) && d.date_debut <= fin && d.date_fin >= debut)
        .map((d) => justif({ ...d, personne_id: PERSONNES.find((p) => p.prenom === d.prenom)?.id ?? d.personne_id }))
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
