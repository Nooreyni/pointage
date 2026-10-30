import { useEffect } from 'react'
import type { Notif } from '../lib/types'
import { heure, jourBxl, dateCourte } from '../lib/temps'

export default function Alertes({ notifs, onVu }: { notifs: Notif[]; onVu: () => void }) {
  useEffect(() => {
    if (notifs.some((n) => !n.lu_le)) { const t = setTimeout(onVu, 1500); return () => clearTimeout(t) }
  }, [notifs, onVu])

  return (
    <section className="carte">
      <h2>Alertes</h2>
      {notifs.length === 0 && <p className="vide">Rien à signaler 👍</p>}
      {notifs.map((n) => (
        <div key={n.id} className={`notif ${n.lu_le ? '' : 'non-lue'}`}>
          <div className="ligne entre"><strong>{n.titre}</strong>
            <span className="doux petit">{dateCourte(jourBxl(new Date(n.cree_le)))} {heure(n.cree_le)}</span></div>
          {n.corps && <div className="doux petit">{n.corps}</div>}
        </div>
      ))}
    </section>
  )
}
