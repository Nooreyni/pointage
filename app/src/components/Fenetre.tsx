import type React from 'react'
import { useDialogue } from './useDialogue'

/** Fenêtre modale commune (Admin, RH…) : Échap ferme, focus gardé dans la fenêtre puis rendu. */
export default function Fenetre({ titre, onFermer, children }: { titre: string; onFermer: () => void; children: React.ReactNode }) {
  const ref = useDialogue<HTMLDivElement>(onFermer)
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <div className="fenetre" ref={ref} onClick={(e) => e.stopPropagation()}><h2>{titre}</h2>{children}</div>
    </div>
  )
}
