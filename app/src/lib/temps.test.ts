import { describe, expect, it } from 'vitest'
import { duree, heure, heureHabituelle, isoBxl, jourBxl } from './temps'
import { calculerJournee } from './demo'
import type { Pointage } from './types'

const pt = (jour: string, hhmm: string, sens: 'entree' | 'sortie'): Pointage => {
  const [h, m] = hhmm.split(':').map(Number)
  const iso = isoBxl(jour, h * 60 + m)
  return { id: iso, horodatage: iso, jour, sens, type_code: 'BUREAU', source: 'web', lieu: 'reseau_cfb', remarque: null,
           annule: false, annule_motif: null, cree_le: iso }
}

describe('heures de Bruxelles', () => {
  it('convertit en heure d’hiver et d’été', () => {
    expect(heure(isoBxl('2026-10-28', 8 * 60))).toBe('08:00')   // UTC+1
    expect(heure(isoBxl('2026-07-01', 8 * 60))).toBe('08:00')   // UTC+2
    expect(isoBxl('2026-10-28', 480)).toBe('2026-10-28T07:00:00.000Z')
    expect(jourBxl(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29')
  })
  it('formate les durées', () => {
    expect(duree(456)).toBe('7h36')
    expect(duree(-15)).toBe('−0h15')
    expect(duree(2, true)).toBe('+0h02')
  })
})

describe('calcul de journée (mêmes règles que le serveur)', () => {
  it('08:00 → 16:08 : pause 30 min déduite, boni +2 min', () => {
    const j = calculerJournee('2026-10-28', [pt('2026-10-28', '08:00', 'entree'), pt('2026-10-28', '16:08', 'sortie')])
    expect([j.pause_deduite, j.preste, j.boni]).toEqual([30, 458, 2])
  })
  it('10 h prestées : boni plafonné à 9 h, 1 h à valider', () => {
    const j = calculerJournee('2026-10-27', [pt('2026-10-27', '07:00', 'entree'), pt('2026-10-27', '17:30', 'sortie')])
    expect([j.preste, j.boni, j.depassement]).toEqual([600, 84, 60])
  })
  it('sortie manquante → journée incomplète', () => {
    expect(calculerJournee('2026-10-26', [pt('2026-10-26', '08:00', 'entree')]).complete).toBe(false)
  })
})

describe('heure habituelle', () => {
  it('médiane des derniers jours, défaut si moins de 5 jours', () => {
    const jours = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']
    const sorties = ['16:30', '16:40', '16:35', '17:10', '16:20'].map((h, i) => pt(jours[i], h, 'sortie'))
    expect(heureHabituelle(sorties, 'sortie', 1020)).toBe(16 * 60 + 35)
    expect(heureHabituelle(sorties.slice(0, 3), 'sortie', 1020)).toBe(1020)
  })
})
