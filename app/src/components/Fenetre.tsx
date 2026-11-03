import type React from 'react'
import { useDialogue } from './useDialogue'
import { IcFermer } from './Icones'

/** Fenêtre modale commune : bouton ✕, Échap ou clic à côté ferment ; focus gardé dans la fenêtre puis rendu. */
export default function Fenetre({ titre, onFermer, children, large }: { titre: string; onFermer: () => void; children: React.ReactNode; large?: boolean }) {
  const ref = useDialogue<HTMLDivElement>(onFermer)
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <div className={`fenetre ${large ? 'large' : ''}`} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="entete-fenetre">
          <h2>{titre}</h2>
          <button type="button" className="fermer-fenetre" aria-label="Fermer" title="Fermer (Échap)" onClick={onFermer}><IcFermer /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
