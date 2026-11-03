import { useState } from 'react'
import type { Profil } from '../lib/types'
import { bienvenue } from '../lib/aide'

const cle = (id: string) => `cfb-bienvenue-${id}`
const dejaVu = (id: string) => { try { return localStorage.getItem(cle(id)) === '1' } catch { return false } }

/** Première connexion : trois conseils selon le rôle. Se ferme d'un clic et ne revient plus (sur cet appareil). */
export default function Bienvenue({ profil, onAide }: { profil: Profil; onAide: () => void }) {
  const [visible, setVisible] = useState(() => !dejaVu(profil.id))
  if (!visible) return null
  const fermer = () => { try { localStorage.setItem(cle(profil.id), '1') } catch { /* navigation privée */ } setVisible(false) }
  return (
    <section className="carte bienvenue" aria-labelledby="titre-bienvenue">
      <h2 id="titre-bienvenue">Bienvenue, {profil.prenom}</h2>
      <ol className="conseils">{bienvenue(profil).map((c) => <li key={c}>{c}</li>)}</ol>
      <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
        <button className="bouton petit" onClick={fermer}>Compris</button>
        <button className="bouton secondaire petit" onClick={() => { fermer(); onAide() }}>Voir l’aide</button>
      </div>
      <p className="doux petit" style={{ marginBottom: 0 }}>Besoin d’aide plus tard ? Le bouton <strong>?</strong> en haut, sur chaque écran.</p>
    </section>
  )
}
