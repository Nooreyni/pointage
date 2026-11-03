import Fenetre from './Fenetre'
import type { EcranAide } from '../lib/aide'

/** Bouton « ? » : l'aide de l'écran ouvert, en un coup d'œil, avec un lien vers toute l'aide. */
export default function AideEcran({ ecran, onToutVoir, onFermer }: { ecran: EcranAide | undefined; onToutVoir: () => void; onFermer: () => void }) {
  return (
    <Fenetre titre={ecran ? `Aide · ${ecran.titre}` : 'Aide'} onFermer={onFermer}>
      {ecran ? <>
        <p className="en-bref">{ecran.enBref}</p>
        {ecran.questions.map((q, i) => (
          <details key={q.q} className="faq" open={i === 0}><summary>{q.q}</summary><p>{q.r}</p></details>
        ))}
      </> : <p className="doux">Toute l’aide est regroupée par écran.</p>}
      <div className="actions">
        <button className="bouton secondaire" onClick={onFermer}>Fermer</button>
        <button className="bouton" onClick={onToutVoir}>Toute l’aide</button>
      </div>
    </Fenetre>
  )
}
