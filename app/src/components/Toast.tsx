import { useEffect, useState } from 'react'
import { IcErreur, IcOk } from './Icones'

export type MessageToast = { texte: string; erreur?: boolean } | null

/** Confirmation ou erreur en bas d'écran : monte en fondu, reste lisible, redescend avant de disparaître (rien n'apparaît ni ne disparaît d'un coup). */
export default function Toast({ message }: { message: MessageToast }) {
  const [affiche, setAffiche] = useState<MessageToast>(message)
  const [sortie, setSortie] = useState(false)
  useEffect(() => {
    if (message) { setAffiche(message); setSortie(false); return }
    if (!affiche) return
    setSortie(true)
    const t = setTimeout(() => { setAffiche(null); setSortie(false) }, 220)
    return () => clearTimeout(t)
  }, [message])
  if (!affiche) return null
  const texte = affiche.texte.replace(/\s*✅/g, '').trim()
  return (
    <div className={`toast ${affiche.erreur ? 'erreur' : ''}`} data-sortie={sortie || undefined} role={affiche.erreur ? 'alert' : 'status'}>
      {affiche.erreur ? <IcErreur /> : <IcOk />}<span>{texte}</span>
    </div>
  )
}
