// Mode démo : données FICTIVES en mémoire, sans serveur (présentation et tests d'interface).
// Les règles de calcul reprennent celles du serveur (pause 30 min au-delà de 6 h, plafond 9 h).
import type { Anomalie, Api, Journee, Notif, Pointage, Presence, Profil, Sens } from './types'
import { decalerJour, isoBxl, jourBxl } from './temps'

const REGIME = [456, 456, 456, 456, 456, 0, 0]
const PAUSE = 30, SEUIL_PAUSE = 360, MAX_JOUR = 540

function prevues(jour: string): number {
  const iso = (new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7
  return REGIME[iso]
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

export function apiDemo(): Api {
  const aujourdhui = jourBxl()
  const profil: Profil = {
    id: 'demo', prenom: 'Sofia', nom: 'Janssens', email: 'sofia.janssens@cfb.test', role: 'employe', type: 'interne',
    service: 'Administration', regime: 'Temps plein 38h', minutes_jour: REGIME, est_chef_service: false,
  }
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
    async deconnexion() { /* rien */ },
  }
}
