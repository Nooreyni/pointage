import { beforeEach, describe, expect, it } from 'vitest'
import type { Api, DemandePointage } from './types'

// Environnement navigateur minimal (localStorage + navigator) pour Node
const memoire = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memoire.get(k) ?? null, setItem: (k: string, v: string) => { memoire.set(k, v) },
    removeItem: (k: string) => { memoire.delete(k) },
  },
})
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

const { definirProprietaire, enAttente, mettreEnAttente, synchroniser } = await import('./file')

const pointage = (id: string): DemandePointage => ({ client_id: id, horodatage: '2026-10-31T07:30:00Z' })
function apiQuiNote(envoyes: string[], erreur?: Error): Api {
  return { pointer: async (d: DemandePointage) => { if (erreur) throw erreur; envoyes.push(d.client_id) } } as unknown as Api
}

describe('file hors ligne par personne (audit R3)', () => {
  beforeEach(() => { memoire.clear(); definirProprietaire(null) })

  it('les pointages en attente de A ne sont jamais envoyés quand B se connecte', async () => {
    definirProprietaire('A'); mettreEnAttente(pointage('a1')); mettreEnAttente(pointage('a2'))
    definirProprietaire(null)
    definirProprietaire('B')
    const envoyes: string[] = []
    expect(enAttente()).toHaveLength(0)
    expect(await synchroniser(apiQuiNote(envoyes))).toBe(0)
    expect(envoyes).toEqual([])
    definirProprietaire('A')
    expect(await synchroniser(apiQuiNote(envoyes))).toBe(2)
    expect(envoyes).toEqual(['a1', 'a2'])
    expect(enAttente()).toHaveLength(0)
  })

  it('hors ligne : la file est gardée, rien n’est perdu', async () => {
    definirProprietaire('A'); mettreEnAttente(pointage('a1'))
    expect(await synchroniser(apiQuiNote([], new Error('Failed to fetch')))).toBe(0)
    expect(enAttente()).toHaveLength(1)
  })

  it('refus métier : le pointage sort de la file (l’anomalie apparaît côté serveur)', async () => {
    definirProprietaire('A'); mettreEnAttente(pointage('a1'))
    expect(await synchroniser(apiQuiNote([], new Error('Pointage trop ancien')))).toBe(1)
    expect(enAttente()).toHaveLength(0)
  })

  it('l’ancienne file sans propriétaire est supprimée, jamais rejouée', () => {
    memoire.set('cfb.pointages-en-attente', JSON.stringify([pointage('x')]))
    definirProprietaire('B')
    expect(memoire.has('cfb.pointages-en-attente')).toBe(false)
    expect(enAttente()).toHaveLength(0)
  })

  it('sans personne connectée : impossible de mettre en attente', () => {
    expect(() => mettreEnAttente(pointage('z'))).toThrow()
  })
})
