import { useEffect, useState } from 'react'
import type { Api, Avis, TypeAvis } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, jourBxl } from '../lib/temps'
import Fenetre from './Fenetre'
import { IcAvis, IcCheck } from './Icones'

export const LIBELLES_AVIS: Record<TypeAvis, string> = {
  probleme: 'Ça ne marche pas', idee: 'Idée / à changer', question: 'Question', ok: 'Ça me va',
  reglage_ok: 'Je confirme', reglage_changer: 'À changer',
}
const GENERAL: TypeAvis[] = ['probleme', 'idee', 'question', 'ok']
const REGLAGE: TypeAvis[] = ['reglage_ok', 'reglage_changer']
const AIDE: Partial<Record<TypeAvis, string>> = {
  probleme: 'Que faisais-tu, et que s’est-il passé ?', idee: 'Qu’est-ce qui serait plus simple ou plus juste ?',
  question: 'Ta question', ok: 'Un commentaire ? (facultatif)', reglage_ok: 'Un commentaire ? (facultatif)',
  reglage_changer: 'Quelle valeur ou quelle règle au CFB ?',
}

/**
 * Fenêtre « Mon avis » (testeurs) : un type en un appui, quelques mots, l'écran est joint tout seul.
 * Avec `parametre` : avis sur un réglage (« Je confirme » / « À changer »).
 */
export function FenetreAvis({ api, ecran, parametre, onFermer, onEnvoye }: {
  api: Api; ecran: string; parametre?: { cle: string; libelle: string; valeur: string }; onFermer: () => void; onEnvoye: (texte: string) => void
}) {
  const types = parametre ? REGLAGE : GENERAL
  const [type, setType] = useState<TypeAvis | null>(null)
  const [message, setMessage] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [deja, setDeja] = useState<Avis[]>([])
  useEffect(() => { api.mesAvis().then(setDeja).catch(() => setDeja([])) }, [api])
  const obligatoire = type !== null && ['probleme', 'idee', 'question', 'reglage_changer'].includes(type)

  async function envoyer(e: React.FormEvent) {
    e.preventDefault(); if (!type) return
    setEnCours(true); setErreur(null)
    try {
      await api.donnerAvis(type, message, ecran, parametre?.cle)
      onEnvoye(parametre ? 'Merci : avis sur le réglage envoyé' : 'Merci : avis envoyé')
    } catch (err) { setErreur(messageErreur(err)) } finally { setEnCours(false) }
  }

  return (
    <Fenetre titre={parametre ? 'Ton avis sur ce réglage' : 'Mon avis'} onFermer={onFermer}>
      <form onSubmit={envoyer} className="pile-form">
        {parametre
          ? <p className="petit" style={{ marginTop: 0 }}><strong>{parametre.libelle}</strong><br /><span className="doux">Valeur actuelle : {parametre.valeur}</span></p>
          : <p className="doux petit" style={{ marginTop: 0 }}>Écran : <strong>{ecran}</strong>. Tout est utile : ce qui bloque, ce qui manque, ce qui est bien.</p>}
        <div className="puces choix-signal" role="group" aria-label="Type d’avis">
          {types.map((t) => <button type="button" key={t} className="puce" aria-pressed={type === t} onClick={() => setType(t)}>{LIBELLES_AVIS[t]}</button>)}
        </div>
        <label className="champ">{type ? AIDE[type] : 'Ton avis'}
          <textarea id="message-avis" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)}
                    placeholder={parametre ? 'Ex. au CFB c’est 45 minutes' : 'Ex. je ne trouve pas où encoder une maladie'} /></label>
        {erreur && <p className="petit negatif" role="alert" style={{ margin: 0 }}>{erreur}</p>}
        <div className="actions">
          <span className="doux petit espace">{deja.length > 0 && `${deja.length} avis déjà envoyé${deja.length > 1 ? 's' : ''} · ${deja.filter((a) => a.traite_le).length} traité${deja.filter((a) => a.traite_le).length > 1 ? 's' : ''}`}</span>
          <button type="button" className="bouton secondaire" onClick={onFermer}>Annuler</button>
          <button className="bouton" disabled={enCours || !type || (obligatoire && !message.trim())}>{enCours ? 'Envoi…' : 'Envoyer'}</button>
        </div>
      </form>
    </Fenetre>
  )
}

/** Bouton flottant « Mon avis », visible sur chaque écran pour les testeurs. */
export function BoutonAvis({ api, ecran }: { api: Api; ecran: string }) {
  const [ouvert, setOuvert] = useState(false)
  const [merci, setMerci] = useState<string | null>(null)
  useEffect(() => { if (!merci) return; const t = setTimeout(() => setMerci(null), 3500); return () => clearTimeout(t) }, [merci])
  return (
    <>
      <button type="button" className="bouton-avis" onClick={() => setOuvert(true)} title="Donner mon avis sur cet écran"><IcAvis />Mon avis</button>
      {ouvert && <FenetreAvis api={api} ecran={ecran} onFermer={() => setOuvert(false)} onEnvoye={(t) => { setOuvert(false); setMerci(t) }} />}
      {merci && <div className="toast" role="status"><IcCheck size={18} />{merci}</div>}
    </>
  )
}

/** Petit rappel de date pour les listes d'avis */
export const quand = (iso: string) => `${dateCourte(jourBxl(new Date(iso)))} ${new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}`
