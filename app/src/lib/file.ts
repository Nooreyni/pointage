// File d'attente des pointages faits hors ligne (rejoués dans l'ordre, sans doublon grâce au client_id).
// Une file PAR PERSONNE : sur un appareil partagé, les pointages en attente de l'un ne sont jamais
// envoyés au nom du suivant (audit R3). Ils partent à la prochaine connexion de leur auteur.
import type { Api, DemandePointage, Pointage } from './types'
import { jourBxl } from './temps'

const PREFIXE = 'cfb.pointages-en-attente'
const ANCIENNE_CLE = PREFIXE                       // version sans propriétaire (avant le 31/10/2026)
let proprietaire: string | null = null

type Entree = DemandePointage & { personne_id: string }

const cle = (id: string) => `${PREFIXE}:${id}`

// À appeler dès que la personne connectée est connue (null à la déconnexion)
export function definirProprietaire(id: string | null) {
  proprietaire = id
  try { localStorage.removeItem(ANCIENNE_CLE) } catch { /* stockage indisponible */ }  // auteur inconnu : jamais rejouée
}

function lire(id: string): Entree[] {
  try {
    const l = JSON.parse(localStorage.getItem(cle(id)) || '[]') as Entree[]
    return Array.isArray(l) ? l.filter((x) => x.personne_id === id) : []
  } catch { return [] }
}

function enregistrer(id: string, liste: Entree[]) {
  try {
    if (liste.length) localStorage.setItem(cle(id), JSON.stringify(liste))
    else localStorage.removeItem(cle(id))
  } catch { /* stockage indisponible */ }
}

export function enAttente(): DemandePointage[] {
  return proprietaire ? lire(proprietaire) : []
}

export function mettreEnAttente(d: DemandePointage) {
  if (!proprietaire) throw new Error('Personne connectée inconnue : pointage non enregistré')
  enregistrer(proprietaire, [...lire(proprietaire), { ...d, personne_id: proprietaire }])
}

export function estErreurReseau(e: unknown): boolean {
  if (!navigator.onLine) return true
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : ''
  return /fetch|network|réseau|Failed to fetch|Load failed/i.test(m)
}

// Rejoue la file de la personne connectée ; s'arrête à la première erreur réseau.
// Renvoie le nombre de pointages traités.
export async function synchroniser(api: Api): Promise<number> {
  const id = proprietaire
  if (!id) return 0
  let n = 0
  for (const d of lire(id)) {
    if (proprietaire !== id) break                   // changement de compte pendant l'envoi : on s'arrête
    try {
      const { personne_id: _, ...demande } = d as Entree
      await api.pointer(demande)
    } catch (e) {
      if (estErreurReseau(e)) break
      // Refus métier (ex. > 72 h) : on retire de la file, l'anomalie apparaîtra côté serveur
    }
    enregistrer(id, lire(id).filter((x) => x.client_id !== d.client_id))
    n++
  }
  return n
}

export function versPointage(d: DemandePointage, sens: Pointage['sens']): Pointage {
  const h = d.horodatage ?? new Date().toISOString()
  return {
    id: d.client_id, horodatage: h, jour: jourBxl(new Date(h)), sens, type_code: d.type_code ?? 'BUREAU', source: 'mobile',
    lieu: 'inconnu', remarque: d.remarque ?? null, annule: false, annule_motif: null, cree_le: h, enAttente: true,
  }
}
