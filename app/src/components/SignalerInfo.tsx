import { useEffect, useState } from 'react'
import type { Api, ChampSignale, Signalement } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, jourBxl } from '../lib/temps'
import Fenetre from './Fenetre'
import { IcCheck } from './Icones'

export const CHAMPS: [ChampSignale, string][] = [
  ['nom', 'Nom ou prénom'], ['email', 'E-mail'], ['service', 'Service'], ['role', 'Rôle'], ['regime', 'Régime de travail'], ['horaire', 'Horaires'], ['autre', 'Autre'],
]
export const libelleChamp = (c: ChampSignale) => CHAMPS.find(([k]) => k === c)?.[1] ?? c

/** « Une info est fausse ? » : la RH reçoit une alerte qui ouvre directement la fiche ; la personne voit le suivi. */
export default function SignalerInfo({ api }: { api: Api }) {
  const [ouvert, setOuvert] = useState(false)
  const [champ, setChamp] = useState<ChampSignale | null>(null)
  const [message, setMessage] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [retour, setRetour] = useState<{ texte: string; erreur?: boolean } | null>(null)
  const [suivi, setSuivi] = useState<Signalement[]>([])
  const charger = () => api.mesSignalements().then(setSuivi).catch(() => setSuivi([]))
  useEffect(() => { charger() }, [api]) // eslint-disable-line react-hooks/exhaustive-deps

  const fermer = () => { setOuvert(false); setChamp(null); setMessage(''); setRetour(null) }
  async function envoyer(e: React.FormEvent) {
    e.preventDefault(); if (!champ) return
    setEnCours(true); setRetour(null)
    try {
      await api.signalerInfo(champ, message)
      fermer(); setRetour({ texte: 'Envoyé à la RH : elle corrige ta fiche et tu es prévenu·e.' }); charger()
    } catch (err) { setRetour({ texte: messageErreur(err), erreur: true }) } finally { setEnCours(false) }
  }
  const enAttente = suivi.filter((s) => !s.traite_le)
  const dernierTraite = suivi.find((s) => s.traite_le)

  return (
    <div className="signaler-info">
      <div className="ligne entre">
        <span className="doux petit">Une info est fausse ?</span>
        <button className="bouton secondaire petit" onClick={() => setOuvert(true)}>Signaler à la RH</button>
      </div>
      {retour && !ouvert && <p className={`petit statut-inline ${retour.erreur ? 'negatif' : 'positif'}`} role="status" style={{ margin: 0 }}>
        {!retour.erreur && <IcCheck size={14} />}{retour.texte}</p>}
      {enAttente.length > 0 && <p className="petit attention" style={{ margin: 0 }}>En attente à la RH : {enAttente.map((s) => libelleChamp(s.champ).toLowerCase()).join(', ')}
        {' '}(envoyé le {dateCourte(jourBxl(new Date(enAttente[enAttente.length - 1].cree_le)))}).</p>}
      {!enAttente.length && dernierTraite && <p className="petit positif" style={{ margin: 0 }}>Ton dernier signalement ({libelleChamp(dernierTraite.champ).toLowerCase()}) a été traité.</p>}

      {ouvert && (
        <Fenetre titre="Signaler une erreur à la RH" onFermer={fermer}>
          <form onSubmit={envoyer} className="pile-form">
            <p className="doux petit" style={{ marginTop: 0 }}>Qu’est-ce qui est faux ? La RH reçoit une alerte et corrige ta fiche.</p>
            <div className="puces choix-signal" role="group" aria-label="Information fausse">
              {CHAMPS.map(([k, l]) => <button type="button" key={k} className="puce" aria-pressed={champ === k} onClick={() => setChamp(k)}>{l}</button>)}
            </div>
            <label className="champ">{champ === 'autre' ? 'Précise (obligatoire)' : 'Précision (facultatif)'}
              <textarea rows={3} maxLength={500} value={message} placeholder="Ex. je suis au CEFOR depuis le 1er octobre" onChange={(e) => setMessage(e.target.value)} /></label>
            {retour?.erreur && <p className="petit negatif" role="alert" style={{ margin: 0 }}>{retour.texte}</p>}
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={fermer}>Annuler</button>
              <button className="bouton" disabled={enCours || !champ || (champ === 'autre' && !message.trim())}>{enCours ? 'Envoi…' : 'Envoyer à la RH'}</button>
            </div>
          </form>
        </Fenetre>
      )}
    </div>
  )
}
