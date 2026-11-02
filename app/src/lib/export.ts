// Exports de tableaux : Excel (.xlsx), CSV (« ; », Excel belge) ou XML. Sans dépendance externe.
import { celluleCsv } from './csv'

export type Format = 'xlsx' | 'csv' | 'xml'
export type Lignes = (string | number)[][]   // première ligne = en-têtes

// « 7,50 » ou « -3 » écrits en texte par les écrans → vrais nombres dans Excel et XML
const NOMBRE = /^-?\d+(,\d+)?$/
const enNombre = (c: string | number): number | null =>
  typeof c === 'number' ? c : NOMBRE.test(c) ? Number(c.replace(',', '.')) : null

const echapperXml = (t: string) => t.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
  // caractères de contrôle interdits en XML 1.0
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

// ---------------------------------------------------------------------------- CSV
export function versCsv(lignes: Lignes): Blob {
  return new Blob(['﻿' + lignes.map((r) => r.map(celluleCsv).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

// ---------------------------------------------------------------------------- XML
/** Nom de balise sûr à partir d'un en-tête : « Heures prestées (h) » → « Heures_prestees_h ». */
export function nomBalise(entete: string, i: number): string {
  const n = entete.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[A-Za-z]/.test(n) ? n : `colonne_${i + 1}${n ? '_' + n : ''}`
}

export function versXml(lignes: Lignes, titre: string): Blob {
  const [entetes, ...corps] = lignes
  const balises = entetes.map((e, i) => nomBalise(String(e), i))
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<export titre="${echapperXml(titre)}" genere_le="${new Date().toISOString()}" source="CFB Pointage">`,
    ...corps.map((r) => '  <ligne>' + r.map((c, i) => {
      const n = enNombre(c)
      return `<${balises[i]}>${n !== null ? n : echapperXml(String(c))}</${balises[i]}>`
    }).join('') + '</ligne>'),
    '</export>', ''].join('\n')
  return new Blob([xml], { type: 'application/xml;charset=utf-8' })
}

// ---------------------------------------------------------------------------- XLSX (zip « stocké », sans compression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export function crc32(d: Uint8Array): number { let c = 0xFFFFFFFF; for (const b of d) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }

export function zip(fichiers: { nom: string; contenu: string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(), parties: Uint8Array[] = [], central: Uint8Array[] = []
  let decalage = 0
  for (const f of fichiers) {
    const nom = enc.encode(f.nom), data = enc.encode(f.contenu), crc = crc32(data)
    const local = new Uint8Array(30 + nom.length), v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true)   // UTF-8
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, nom.length, true)
    local.set(nom, 30)
    const cd = new Uint8Array(46 + nom.length), w = new DataView(cd.buffer)
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true)
    w.setUint32(16, crc, true); w.setUint32(20, data.length, true); w.setUint32(24, data.length, true); w.setUint16(28, nom.length, true)
    w.setUint32(42, decalage, true); cd.set(nom, 46)
    parties.push(local, data); central.push(cd); decalage += local.length + data.length
  }
  const tailleCd = central.reduce((t, c) => t + c.length, 0)
  const fin = new Uint8Array(22), e = new DataView(fin.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, fichiers.length, true); e.setUint16(10, fichiers.length, true)
  e.setUint32(12, tailleCd, true); e.setUint32(16, decalage, true)
  const tout = new Uint8Array(new ArrayBuffer(decalage + tailleCd + 22)); let o = 0
  for (const p of [...parties, ...central, fin]) { tout.set(p, o); o += p.length }
  return tout
}

const colonne = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

export function versXlsx(lignes: Lignes, feuille: string): Blob {
  const lignesXml = lignes.map((r, y) => `<row r="${y + 1}">` + r.map((c, x) => {
    const ref = `${colonne(x)}${y + 1}`, n = y > 0 ? enNombre(c) : null
    if (n !== null) return `<c r="${ref}"><v>${n}</v></c>`
    return `<c r="${ref}" t="inlineStr"${y === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${echapperXml(String(c))}</t></is></c>`
  }).join('') + '</row>').join('')
  const largeurs = (lignes[0] ?? []).map((_, x) => Math.min(48, Math.max(8, ...lignes.map((r) => String(r[x] ?? '').length + 2))))
  const nomFeuille = echapperXml(feuille.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Export')
  const data = zip([
    { nom: '[Content_Types].xml', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nom: '_rels/.rels', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nom: 'xl/workbook.xml', contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nomFeuille}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nom: 'xl/_rels/workbook.xml.rels', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nom: 'xl/styles.xml', contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { nom: 'xl/worksheets/sheet1.xml', contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${largeurs.map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join('')}</cols><sheetData>${lignesXml}</sheetData></worksheet>` },
  ])
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** Télécharge le tableau dans le format choisi. `nom` sans extension. */
export function telecharger(lignes: Lignes, nom: string, format: Format, titre = nom) {
  const blob = format === 'xlsx' ? versXlsx(lignes, titre) : format === 'xml' ? versXml(lignes, titre) : versCsv(lignes)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${nom}.${format}`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
