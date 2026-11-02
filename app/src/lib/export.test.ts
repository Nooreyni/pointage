import { describe, expect, it } from 'vitest'
import { crc32, nomBalise, versXml, zip } from './export'

describe('exports', () => {
  it('crc32 conforme (valeur de référence de « 123456789 »)', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926)
  })
  it('zip : en-têtes local, central et fin', () => {
    const z = zip([{ nom: 'a.txt', contenu: 'bonjour' }])
    const v = new DataView(z.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50)
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1)
  })
  it('XML : balises sûres, valeurs échappées, nombres', async () => {
    expect(nomBalise('Heures prestées (h)', 0)).toBe('Heures_prestees_h')
    expect(nomBalise('1er jour', 2)).toBe('colonne_3_1er_jour')
    const xml = await versXml([['Nom', 'Heures (h)'], ['Dupont & <fils>', '7,50']], 'Test').text()
    expect(xml).toContain('<Nom>Dupont &amp; &lt;fils&gt;</Nom>')
    expect(xml).toContain('<Heures_h>7.5</Heures_h>')
  })
})
