import { useState } from 'react'
import type { Api } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { IcCheck } from './Icones'

/** Abonnement agenda : un lien personnel à ajouter une fois dans Outlook ; congés accordés et fériés s'y mettent à jour seuls. */
export default function AgendaOutlook({ api }: { api: Api }) {
  const [lien, setLien] = useState<string | null>(null)
  const [copie, setCopie] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const obtenir = async (regenerer = false) => {
    setErreur(null); setCopie(false)
    try { setLien(await api.lienAgenda(regenerer)) } catch (e) { setErreur(messageErreur(e)) }
  }
  return (
    <div>
      <p className="doux petit" style={{ marginTop: 0 }}>Tes congés accordés et les jours fériés apparaissent dans ton agenda Outlook et se mettent à jour tout seuls.</p>
      {!lien ? <button className="bouton secondaire" onClick={() => obtenir()}>Obtenir mon lien d’agenda</button> : <>
        <div className="ligne lien-agenda">
          <input id="lien-agenda" readOnly value={lien} aria-label="Lien d’agenda" onFocus={(e) => e.target.select()} />
          <button className="bouton secondaire petit" onClick={async () => { try { await navigator.clipboard.writeText(lien); setCopie(true) } catch { (document.getElementById('lien-agenda') as HTMLInputElement)?.select() } }}>
            {copie ? <><IcCheck size={14} />Copié</> : 'Copier'}</button>
        </div>
        <ol className="petit etapes-agenda">
          <li>Outlook › Calendrier › <strong>Ajouter un calendrier</strong> › <strong>À partir d’Internet</strong> (s’abonner).</li>
          <li>Colle le lien, nomme-le « CFB congés », valide.</li>
        </ol>
        <p className="doux petit">Ce lien est personnel : ne le partage pas. <button className="lien petit" onClick={() => obtenir(true)}>Créer un nouveau lien</button> (l’ancien cesse de fonctionner).</p>
      </>}
      {erreur && <p className="negatif petit" role="alert">{erreur}</p>}
    </div>
  )
}
