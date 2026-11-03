import { Component, type ReactNode } from 'react'
import { signalerErreur } from '../lib/erreurs'

/** Si un écran plante : un message clair et un bouton pour recharger, au lieu d'une page blanche. L'erreur est signalée à l'IT. */
export default class Secours extends Component<{ children: ReactNode }, { erreur: boolean }> {
  state = { erreur: false }
  static getDerivedStateFromError() { return { erreur: true } }
  componentDidCatch(e: Error) { signalerErreur(e) }
  render() {
    if (!this.state.erreur) return this.props.children
    return (
      <div className="connexion"><div className="carte">
        <h1>Un problème est survenu</h1>
        <p className="doux">L’écran n’a pas pu s’afficher. L’erreur a été signalée automatiquement à l’IT. Tes pointages déjà faits sont enregistrés.</p>
        <button className="bouton" onClick={() => location.reload()}>Recharger</button>
      </div></div>
    )
  }
}
