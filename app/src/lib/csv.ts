// Export CSV commun : séparateur « ; » (Excel belge), BOM UTF-8, cellules à risque neutralisées (=, +, -, @)
export function celluleCsv(c: string | number): string {
  let v = String(c)
  if (typeof c === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = `'${v}`
  return `"${v.replace(/"/g, '""')}"`
}

export function telechargerCsv(lignes: (string | number)[][], nom: string) {
  const csv = lignes.map((r) => r.map(celluleCsv).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = nom; a.click()
  URL.revokeObjectURL(url)
}
