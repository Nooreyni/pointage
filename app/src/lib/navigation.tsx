import { createContext, useContext } from 'react'

/** Où mène un lien interne : la fiche d'une personne, sa fiche de temps, une section des réglages, un écran. */
export type CibleNav =
  | { vers: 'personne'; id: string; onglet?: OngletFiche }
  | { vers: 'temps'; id: string }
  | { vers: 'reglages'; section: 'services' | 'regimes' | 'acces' | 'compteurs' | 'parametres' | 'reseau' | 'journal' | 'avis' | 'lancement' }
  | { vers: 'onglet'; onglet: string }
export type OngletFiche = 'identite' | 'travail' | 'compte' | 'soldes' | 'depart'

type Nav = { naviguer: (c: CibleNav) => void; ficheRH: boolean; ficheTemps: boolean; reglages: boolean }
export const NavContext = createContext<Nav>({ naviguer: () => {}, ficheRH: false, ficheTemps: false, reglages: false })
export const useNav = () => useContext(NavContext)

/**
 * Nom d'une personne cliquable : ouvre sa fiche RH (gestion) ou sa fiche de temps (responsable).
 * Sans droit, reste un simple texte. `vers="temps"` force la fiche de temps (anomalies, heures).
 */
export function LienPersonne({ id, nom, vers }: { id: string; nom: string; vers?: 'personne' | 'temps' }) {
  const { naviguer, ficheRH, ficheTemps } = useNav()
  const cible = vers === 'temps' ? (ficheTemps ? 'temps' : null) : ficheRH ? 'personne' : ficheTemps ? 'temps' : null
  if (!cible) return <strong>{nom}</strong>
  return (
    <button type="button" className="lien-nom" title={cible === 'personne' ? 'Ouvrir sa fiche' : 'Voir sa fiche de temps'}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); naviguer({ vers: cible, id }) }}>{nom}</button>
  )
}

/** Lien vers une section des réglages (seulement si on y a accès ; sinon texte simple). */
export function LienReglages({ section, children }: { section: Extract<CibleNav, { vers: 'reglages' }>['section']; children: React.ReactNode }) {
  const { naviguer, reglages } = useNav()
  if (!reglages) return <strong>{children}</strong>
  return <button type="button" className="lien-inline" onClick={() => naviguer({ vers: 'reglages', section })}>{children}</button>
}
