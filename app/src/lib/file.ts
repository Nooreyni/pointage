// File d'attente des pointages faits hors ligne (rejoués dans l'ordre, sans doublon grâce au client_id)
import type { Api, DemandePointage, Pointage } from './types'
import { jourBxl } from './temps'

const CLE = 'cfb.pointages-en-attente'

export function enAttente(): DemandePointage[] {
  try { return JSON.parse(localStorage.getItem(CLE) || '[]') } catch { return [] }
}

function enregistrer(liste: DemandePointage[]) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)) } catch { /* stockage indisponible */ }
}

export function mettreEnAttente(d: DemandePointage) {
  enregistrer([...enAttente(), d])
}

export function estErreurReseau(e: unknown): boolean {
  if (!navigator.onLine) return true
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : ''
  return /fetch|network|réseau|Failed to fetch|Load failed/i.test(m)
}

// Rejoue la file ; s'arrête à la première erreur réseau. Renvoie le nombre de pointages synchronisés.
export async function synchroniser(api: Api): Promise<number> {
  let n = 0
  for (const d of enAttente()) {
    try {
      await api.pointer(d)
    } catch (e) {
      if (estErreurReseau(e)) break
      // Refus métier (ex. > 72 h) : on retire de la file, l'anomalie apparaîtra côté serveur
    }
    enregistrer(enAttente().filter((x) => x.client_id !== d.client_id))
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
