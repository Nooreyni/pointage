import { describe, expect, it } from 'vitest'
import { versMinutes } from './ImportSoldes'

describe('reprise des soldes : lecture des durées', () => {
  it('accepte les formats courants', () => {
    expect(versMinutes('114:30')).toBe(6870)
    expect(versMinutes('114h30')).toBe(6870)
    expect(versMinutes('114,5')).toBe(6870)
    expect(versMinutes(' 7 ')).toBe(420)
    expect(versMinutes('-3:48')).toBe(-228)
  })
  it('refuse ce qui est illisible', () => {
    expect(versMinutes('')).toBeNull()
    expect(versMinutes('abc')).toBeNull()
    expect(versMinutes('1:2:3')).toBeNull()
  })
})
