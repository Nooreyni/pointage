import { useEffect, useState } from 'react'
import { IcCheck } from './Icones'
import type { Api } from '../lib/types'
import { messageErreur } from '../lib/supabase'

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/**
 * Jours de télétravail habituels d'une personne. Chacun modifie les siens (son responsable est prévenu) ;
 * la RH, l'admin et le N+1 peuvent aussi les modifier (la personne est prévenue). Droits vérifiés par le serveur.
 */
export default function TeletravailHabituel({ api, personneId, moi, detaille }: { api: Api; personneId: string; moi: boolean; detaille?: boolean }) {
  const [etat, setEtat] = useState<{ jours: number[]; modifiable: boolean } | null>(null)
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null)

  useEffect(() => {
    setEtat(null); setMessage(null)
    api.teletravailDe(personneId).then(setEtat).catch(() => setEtat({ jours: [], modifiable: false }))
  }, [api, personneId])

  if (!etat) return null
  const basculer = async (j: number) => {
    const jours = etat.jours.includes(j) ? etat.jours.filter((x) => x !== j) : [...etat.jours, j].sort()
    setEtat({ ...etat, jours })
    try { await api.definirTeletravail(personneId, jours); setMessage({ texte: moi ? 'Enregistré, ton responsable est prévenu' : 'Enregistré, la personne est prévenue' }) }
    catch (e) { setEtat(etat); setMessage({ texte: messageErreur(e), erreur: true }) }
  }

  return (
    <div className="teletravail" role="group" aria-label="Jours de télétravail habituels">
      <span className="etiquette-tt">Télétravail habituel</span>
      {etat.modifiable ? (
        <span className="jours-tt">{JOURS.slice(0, 5).map((l, i) => (
          <button key={l} className="puce" aria-pressed={etat.jours.includes(i + 1)} onClick={() => basculer(i + 1)}>{l}</button>
        ))}</span>
      ) : (
        <strong className="petit">{etat.jours.length ? etat.jours.map((j) => JOURS[j - 1]).join(', ') : 'aucun'}</strong>
      )}
      {message && <span className={`petit statut-inline ${message.erreur ? 'negatif' : 'positif'}`} role="status">{!message.erreur && <IcCheck size={14} />}{message.texte}</span>}
      {!etat.modifiable && <span className="doux petit">défini par la RH ou le responsable</span>}
      {detaille && etat.modifiable && moi && !message && (
        <p className="doux petit aide-tt">Change-les quand tu veux : ton responsable est prévenu automatiquement. Ces jours-là, ton pointage
          passe en « Télétravail » tout seul. Un autre jour, choisis simplement « Télétravail » au moment de pointer.</p>
      )}
    </div>
  )
}
