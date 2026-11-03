import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const menu = useRef<HTMLDivElement>(null)
  const [versHaut, setVersHaut] = useState(false)
  // Pas assez de place sous le bouton (bas d'écran, barre du bas sur mobile) : le menu s'ouvre vers le haut
  useLayoutEffect(() => {
    if (!ouvert || !ref.current || !menu.current) return
    const bas = ref.current.getBoundingClientRect().bottom + menu.current.offsetHeight + 12
    const limite = innerHeight - (document.querySelector('.nav')?.getBoundingClientRect().top ?? innerHeight) > 0 && innerWidth < 900
      ? document.querySelector('.nav')!.getBoundingClientRect().top : innerHeight
    setVersHaut(bas > limite)
  }, [ouvert])
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
        <div ref={menu} className={`menu menu-export ${versHaut ? 'vers-haut' : ''}`} role="menu">
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
