import { useMemo, useState } from 'react'
import type { Profil } from '../lib/types'
import { aidePour } from '../lib/aide'

const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Toute l'aide, regroupée par écran et adaptée au rôle ; recherche dans les questions et les réponses. */
export default function Aide({ profil, onAller }: { profil: Profil; onAller?: (ecran: string) => void }) {
  const [q, setQ] = useState('')
  const tout = useMemo(() => aidePour(profil), [profil])
  const m = sansAccent(q.trim())
  const ecrans = m ? tout.map((e) => ({ ...e, questions: e.questions.filter((x) => sansAccent(`${e.titre} ${x.q} ${x.r}`).includes(m)) }))
    .filter((e) => e.questions.length) : tout
  const nb = ecrans.reduce((t, e) => t + e.questions.length, 0)
  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <section className="carte">
          <h2>Aide</h2>
          <p className="doux petit">Le bouton <strong>?</strong> en haut affiche l’aide de l’écran où tu es. Ici, tout est regroupé.
            La loupe (ou Ctrl + K) retrouve un écran, une personne ou un réglage.</p>
          <input type="search" id="recherche-aide" className="recherche pleine" placeholder="Chercher : congé, mot de passe, télétravail…"
                 aria-label="Chercher dans l’aide" value={q} onChange={(e) => setQ(e.target.value)} />
          {m && <p className="doux petit" role="status" style={{ marginBottom: 0 }}>{nb ? `${nb} réponse(s)` : 'Rien trouvé : essaie un autre mot, ou demande à la RH.'}</p>}
        </section>
        <div className="grille-cartes">
          {ecrans.map((e) => (
            <section key={e.id} className="carte">
              <div className="ligne entre"><h2>{e.titre}</h2>
                {onAller && e.id !== 'aide' && <button className="lien petit" onClick={() => onAller(e.id)}>Ouvrir l’écran</button>}</div>
              <p className="en-bref">{e.enBref}</p>
              {e.questions.map((x) => (
                <details key={x.q} className="faq" open={!!m}><summary>{x.q}</summary><p>{x.r}</p></details>
              ))}
            </section>
          ))}
        </div>
        <p className="doux petit" style={{ textAlign: 'center' }}>Une question qui n’est pas ici ? Demande à la RH.</p>
      </div>
    </main>
  )
}
