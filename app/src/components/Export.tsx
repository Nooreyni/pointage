import { useEffect, useRef, useState } from 'react'
import type { Format } from '../lib/export'
import { IcChevron } from './Icones'

const FORMATS: [Format, string, string][] = [
  ['xlsx', 'Excel', '.xlsx'],
  ['csv', 'CSV', 'tableur, Excel belge'],
  ['xml', 'XML', 'échange avec un autre logiciel'],
]

/** Bouton « Exporter » : un petit menu Excel / CSV / XML. */
export default function Export({ onExporter, disabled }: { onExporter: (f: Format) => void; disabled?: boolean }) {
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ouvert) return
    const clic = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOuvert(false) }
    const clavier = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('click', clic); document.addEventListener('keydown', clavier)
    return () => { document.removeEventListener('click', clic); document.removeEventListener('keydown', clavier) }
  }, [ouvert])
  return (
    <div className="export" ref={ref}>
      <button className="bouton secondaire petit" disabled={disabled} aria-expanded={ouvert} aria-haspopup="menu" onClick={() => setOuvert((o) => !o)}>
        Exporter<IcChevron className={`chevron-mini ${ouvert ? 'ouvert' : ''}`} size={14} />
      </button>
      {ouvert && (
        <div className="menu menu-export" role="menu">
          {FORMATS.map(([f, libelle, aide]) => (
            <button key={f} role="menuitem" onClick={() => { setOuvert(false); onExporter(f) }}>
              <strong>{libelle}</strong><span className="doux petit">{aide}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
