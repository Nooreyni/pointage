import { useEffect, useState } from 'react'
import type { AdminPersonne, Api } from '../lib/types'
import type { OngletFiche } from '../lib/navigation'
import { messageErreur } from '../lib/supabase'
import { jourBxl } from '../lib/temps'
import { IcCheck, IcChevron } from './Icones'

type Etape = { ok: boolean; texte: string; aller?: OngletFiche; action?: React.ReactNode }

/** Arrivée (onboarding) : les étapes pour qu'une nouvelle personne puisse travailler dès son premier jour. Chaque étape mène à son onglet. */
export default function ArriveePersonne({ api, personne, onFait, onAller }: {
  api: Api; personne: AdminPersonne; onFait: (t: string, erreur?: boolean) => void; onAller: (o: OngletFiche) => void
}) {
  const annee = Number(jourBxl().slice(0, 4))
  const [conges, setConges] = useState<boolean | null>(null)
  const [tt, setTt] = useState<boolean | null>(null)
  const [ouvert, setOuvert] = useState(true)
  useEffect(() => {
    api.soldesPersonne(personne.id).then((s) => setConges(s.some((x) => x.compteur_code === 'CONGE_LEGAL' && x.periode_debut.startsWith(String(annee))))).catch(() => setConges(false))
    api.teletravailDe(personne.id).then((t) => setTt(t.jours.length > 0)).catch(() => setTt(false))
  }, [api, personne.id, annee])
  const etapes: Etape[] = [
    { ok: true, texte: 'Fiche créée', aller: 'identite' },
    { ok: !!personne.regime, texte: personne.regime ? `Régime : ${personne.regime}` : 'Choisir le régime de travail', aller: 'travail' },
    { ok: personne.compte_lie, texte: personne.compte_lie ? 'Compte de connexion actif' : 'Créer son compte (mot de passe)', aller: 'compte' },
    { ok: !!conges, texte: conges ? `Congés ${annee} attribués` : `Attribuer ses congés ${annee}`, aller: 'soldes', action: !conges && conges !== null && (
      <button className="bouton secondaire petit" onClick={async () => {
        try { const n = await api.attribuerConges(annee, [personne.id]); setConges(true); onFait(n ? `Congés ${annee} attribués (au prorata)` : 'Aucun congé à attribuer (régime ou date d’entrée)') }
        catch (e) { onFait(messageErreur(e), true) }
      }}>Attribuer au prorata</button>) },
    { ok: !!tt, texte: tt ? 'Télétravail habituel défini' : 'Télétravail habituel (facultatif)', aller: 'travail' },
  ]
  const faites = etapes.filter((e) => e.ok).length
  if (conges === null || tt === null) return null
  return (
    <div className="arrivee">
      <button type="button" className="arrivee-titre" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
        <strong>Arrivée</strong><span className="doux petit">{faites} / {etapes.length} étapes</span>
        <span className="barre fine" aria-hidden="true"><span style={{ width: `${(100 * faites) / etapes.length}%` }} /></span>
        <IcChevron size={16} />
      </button>
      {ouvert && (
        <ol className="etapes">{etapes.map((e, i) => (
          <li key={i} className={e.ok ? 'ok' : 'ko'}>
            <span className="pastille-etape" aria-hidden="true">{e.ok ? <IcCheck size={14} /> : i + 1}</span>
            {e.aller && !e.ok
              ? <button type="button" className="lien-etape" onClick={() => onAller(e.aller!)}>{e.texte}</button>
              : <span className="texte-etape">{e.texte}</span>}
            {e.action}
          </li>
        ))}</ol>
      )}
    </div>
  )
}
