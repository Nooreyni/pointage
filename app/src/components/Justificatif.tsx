import { useRef, useState } from 'react'
import { IcTrombone } from './Icones'
import type { Api, Demande } from '../lib/types'
import { messageErreur } from '../lib/supabase'

const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX = 10 * 1024 * 1024

/** Justificatif d'une demande : badge « manquant », dépôt (PDF / photo), ouverture (lien temporaire), retrait. */
export default function Justificatif({ api, d, peutDeposer, onChange }: {
  api: Api; d: Demande; peutDeposer: boolean; onChange: (message: string, erreur?: boolean) => void
}) {
  const champ = useRef<HTMLInputElement>(null)
  const [enCours, setEnCours] = useState(false)
  if (d.statut === 'refusee' || d.statut === 'annulee') return null
  // Utile seulement si requis, déjà joint, ou absence encodée par la RH (maladie…) — pas sur chaque congé
  if (!d.justificatif_joint && !d.justificatif_requis && !d.encode_par_rh) return null

  async function deposer(f: File | undefined) {
    if (!f) return
    if (!TYPES.includes(f.type)) return onChange('Format accepté : PDF ou photo (JPEG, PNG, HEIC)', true)
    if (f.size > MAX) return onChange('Fichier trop lourd (10 Mo maximum)', true)
    setEnCours(true)
    try { await api.deposerJustificatif(d, f); onChange('Justificatif joint ✅') } catch (e) { onChange(messageErreur(e), true) }
    finally { setEnCours(false); if (champ.current) champ.current.value = '' }
  }
  async function ouvrir() {
    const fenetre = window.open('', '_blank')     // ouverte tout de suite (sinon bloquée par le navigateur)
    try { const url = await api.lienJustificatif(d.justificatif_chemin!); if (fenetre) fenetre.location.href = url; else location.href = url }
    catch (e) { fenetre?.close(); onChange(messageErreur(e), true) }
  }

  return (
    <span className="justificatif">
      {d.justificatif_joint
        ? (d.justificatif_chemin
            ? <button className="lien petit" onClick={ouvrir} title="Ouvrir le justificatif"><IcTrombone /> Justificatif</button>
            : <span className="pilule ok" title="Visible par la RH"><IcTrombone /> Joint</span>)
        : d.justificatif_requis && <span className="pilule attente">Justificatif manquant</span>}
      {peutDeposer && <>
        <input ref={champ} type="file" accept={TYPES.join(',')} hidden onChange={(e) => deposer(e.target.files?.[0])}
               aria-label={`Joindre un justificatif (${d.libelle_absence})`} />
        <button className="lien petit" disabled={enCours} onClick={() => champ.current?.click()}>
          {enCours ? 'Envoi…' : d.justificatif_joint ? 'Remplacer' : 'Joindre'}</button>
        {d.justificatif_joint && d.justificatif_chemin && (
          <button className="lien petit" disabled={enCours} onClick={async () => {
            try { await api.retirerJustificatif(d); onChange('Justificatif retiré') } catch (e) { onChange(messageErreur(e), true) }
          }}>Retirer</button>
        )}
      </>}
    </span>
  )
}
