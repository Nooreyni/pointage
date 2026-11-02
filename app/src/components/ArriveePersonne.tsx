import { useEffect, useState } from 'react'
import type { AdminPersonne, Api } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { jourBxl } from '../lib/temps'
import { IcCheck } from './Icones'

/** Arrivée (onboarding) : les étapes pour qu'une nouvelle personne puisse travailler dès son premier jour. */
export default function ArriveePersonne({ api, personne, onFait }: { api: Api; personne: AdminPersonne; onFait: (t: string, erreur?: boolean) => void }) {
  const annee = Number(jourBxl().slice(0, 4))
  const [conges, setConges] = useState<boolean | null>(null)
  const [tt, setTt] = useState<boolean | null>(null)
  useEffect(() => {
    api.soldesPersonne(personne.id).then((s) => setConges(s.some((x) => x.compteur_code === 'CONGE_LEGAL' && x.periode_debut.startsWith(String(annee))))).catch(() => setConges(false))
    api.teletravailDe(personne.id).then((t) => setTt(t.jours.length > 0)).catch(() => setTt(false))
  }, [api, personne.id, annee])
  const etapes: [boolean, string, React.ReactNode?][] = [
    [true, 'Fiche créée (service, rôle, date d’entrée)'],
    [!!personne.regime, personne.regime ? `Régime : ${personne.regime}` : 'Régime de travail à choisir (plus bas)'],
    [personne.compte_lie, personne.compte_lie ? 'Compte de connexion actif' : 'Compte de connexion : générer son mot de passe (plus bas)'],
    [!!conges, conges ? `Congés ${annee} attribués` : `Congés ${annee} à attribuer`, !conges && conges !== null && (
      <button className="bouton secondaire petit" onClick={async () => {
        try { const n = await api.attribuerConges(annee, [personne.id]); setConges(true); onFait(n ? `Congés ${annee} attribués (au prorata)` : 'Aucun congé à attribuer (régime ou date d’entrée)') }
        catch (e) { onFait(messageErreur(e), true) }
      }}>Attribuer (au prorata)</button>)],
    [!!tt, tt ? 'Jours de télétravail habituels définis' : 'Jours de télétravail habituels (facultatif, plus bas)'],
  ]
  const faites = etapes.filter(([ok]) => ok).length
  return (
    <div className="arrivee">
      <div className="barre fine" aria-hidden="true"><span style={{ width: `${(100 * faites) / etapes.length}%` }} /></div>
      <ul className="controle">{etapes.map(([ok, texte, action], i) => (
        <li key={i} className={ok ? 'ok' : 'ko'}><span>{ok ? <IcCheck size={14} /> : i + 1}</span><span className="texte-ligne">{texte}</span>{action}</li>
      ))}</ul>
    </div>
  )
}
