import { describe, expect, it } from 'vitest'
import { secondesRestantes } from './useInactivite'

describe('déconnexion après inactivité', () => {
  const t0 = 1_800_000_000_000
  it('30 min : rien à signaler pendant 29 min, avertissement la dernière minute, déconnexion à 30 min', () => {
    expect(secondesRestantes(t0, 30, t0 + 29 * 60_000 - 1000)).toBeGreaterThan(60)
    expect(secondesRestantes(t0, 30, t0 + 29 * 60_000 + 30_000)).toBe(30)
    expect(secondesRestantes(t0, 30, t0 + 30 * 60_000)).toBeLessThanOrEqual(0)
  })
  it('appli en arrière-plan : le temps écoulé compte (horloge réelle)', () => {
    expect(secondesRestantes(t0, 30, t0 + 2 * 3_600_000)).toBeLessThan(0)
  })
})
