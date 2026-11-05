import { useMemo, useState } from 'react'
import type { Profil } from '../lib/types'
import { aidePour } from '../lib/aide'

const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Les questions les plus posées, proposées d'un appui (si elles existent pour ce rôle). */
const FREQUENTES = ['J’ai oublié de pointer.', 'Demander un congé', 'Qui régularise un jour « À régulariser » ?', 'Changer mon mot de passe', 'Indiquer mes horaires habituels']

/**
 * Toute l'aide, adaptée au rôle : un sommaire (les écrans) et une rubrique à la fois, au lieu d'un long mur de cartes.
 * La recherche parcourt toutes les rubriques et ouvre les réponses trouvées.
 */
export default function Aide({ profil, onAller }: { profil: Profil; onAller?: (ecran: string) => void }) {
  const tout = useMemo(() => aidePour(profil), [profil])
  const [q, setQ] = useState('')
  const [rubrique, setRubrique] = useState(tout[0]?.id ?? '')
  const [ouverte, setOuverte] = useState<string | null>(null)
  const m = sansAccent(q.trim())
  const trouves = m ? tout.map((e) => ({ ...e, questions: e.questions.filter((x) => sansAccent(`${e.titre} ${x.q} ${x.r}`).includes(m)) }))
    .filter((e) => e.questions.length) : []
  const nb = trouves.reduce((t, e) => t + e.questions.length, 0)
  const affichees = m ? trouves : tout.filter((e) => e.id === rubrique)
  const frequentes = FREQUENTES.map((f) => tout.flatMap((e) => e.questions.map((x) => ({ ...x, ecran: e.id }))).find((x) => x.q === f)).filter((x) => !!x)
  const ouvrir = (ecran: string, question: string) => { setQ(''); setRubrique(ecran); setOuverte(question) }

  return (
    <main className="contenu page-aide">
      <section className="carte col-pleine entete-aide">
        <div className="ligne entre barre-outils">
          <div><h2>Aide</h2>
            <p className="doux petit" style={{ margin: '2px 0 0' }}>Le bouton <strong>?</strong> en haut explique l’écran où tu es. La loupe (Ctrl + K) retrouve un écran, une personne, un réglage.</p></div>
        </div>
        <input type="search" id="recherche-aide" className="recherche pleine" placeholder="Chercher : congé, mot de passe, télétravail…"
               aria-label="Chercher dans l’aide" value={q} onChange={(e) => setQ(e.target.value)} />
        {m ? <p className="doux petit" role="status" style={{ margin: 0 }}>{nb ? `${nb} réponse(s) dans ${trouves.length} rubrique(s)` : 'Rien trouvé : essaie un autre mot, ou demande à la RH.'}</p>
          : frequentes.length > 0 && (
            <div className="frequentes"><span className="doux petit">Souvent demandé :</span>
              {frequentes.map((x) => <button key={x.q} className="puce" onClick={() => ouvrir(x.ecran, x.q)}>{x.q.replace(/[.?]$/, '')}</button>)}
            </div>)}
      </section>

      <nav className="sommaire-aide" aria-label="Rubriques de l’aide">
        {tout.map((e) => {
          const n = m ? trouves.find((t) => t.id === e.id)?.questions.length ?? 0 : e.questions.length
          return (
            <button key={e.id} className="rubrique" aria-current={!m && rubrique === e.id ? 'true' : undefined} disabled={!!m && !n}
                    onClick={() => { setQ(''); setRubrique(e.id); setOuverte(null) }}>
              <span>{e.titre}</span><span className="doux petit">{n}</span>
            </button>
          )
        })}
      </nav>

      <div className="pile contenu-aide">
        {affichees.map((e) => (
          <section key={e.id} className="carte">
            <div className="ligne entre"><h2>{e.titre}</h2>
              {onAller && e.id !== 'aide' && <button className="bouton secondaire petit" onClick={() => onAller(e.id)}>Ouvrir l’écran</button>}</div>
            <p className="en-bref">{e.enBref}</p>
            {e.questions.map((x) => (
              <details key={x.q} className="faq" open={!!m || ouverte === x.q}><summary>{x.q}</summary><p>{x.r}</p></details>
            ))}
          </section>
        ))}
        <p className="doux petit" style={{ textAlign: 'center', margin: 0 }}>Une question qui n’est pas ici ? Demande à la RH.
          {' '}Une info fausse sur ta fiche ? Mon compte › « Signaler à la RH ».</p>
      </div>
    </main>
  )
}
