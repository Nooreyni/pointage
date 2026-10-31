import { describe, expect, it } from 'vitest'
import { celluleCsv } from './csv'

describe('export CSV', () => {
  it('neutralise les formules (injection Excel)', () => {
    expect(celluleCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(celluleCsv('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
  })
  it('laisse les nombres négatifs intacts', () => {
    expect(celluleCsv('-1,50')).toBe('"-1,50"')
    expect(celluleCsv(-3)).toBe('"-3"')
  })
})
