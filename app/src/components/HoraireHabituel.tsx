import { useEffect, useState } from 'react'
import { IcCheck } from './Icones'
import type { Api, Horaire } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { duree, hhmm } from '../lib/temps'

/** Horaires les plus courants au CFB : un appui suffit. « Autre » ouvre deux champs libres. */
export const HORAIRES_COURANTS: [number, number][] = [[450, 930], [480, 900], [480, 960], [510, 990], [540, 1020]]
export const etiquetteHeure = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
export const etiquetteHoraire = (a: number, d: number) => `${etiquetteHeure(a)} – ${etiquetteHeure(d)}`
const versMin = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }
const PAUSE = 30

/**
 * Horaires habituels d'une personne (arrivée → départ). Servent aux rappels, à l'heure proposée quand on corrige un oubli
 * et à la fin de journée estimée. Ne changent pas les heures dues (c'est le régime). Droits vérifiés par le serveur.
 */
export default function HoraireHabituel({ api, personneId, moi, minutesJour, onEnregistre }: {
  api: Api; personneId?: string; moi: boolean; minutesJour?: number[] | null; onEnregistre?: (h: Horaire) => void
}) {
  const [h, setH] = useState<Horaire | null>(null)
  const [autre, setAutre] = useState<{ a: string; d: string } | null>(null)
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    setH(null); setAutre(null); setMessage(null)
    api.horaireDe(personneId).then(setH).catch(() => setH(null))
  }, [api, personneId])
  if (!h) return null

  const choisi = h.arrivee !== null && h.depart !== null ? [h.arrivee, h.depart] as [number, number] : null
  const courant = choisi && HORAIRES_COURANTS.some(([a, d]) => a === choisi[0] && d === choisi[1])
  async function enregistrer(a: number | null, d: number | null) {
    setEnCours(true); setMessage(null)
    try {
      await api.definirHoraire(a, d, personneId)
      const n = await api.horaireDe(personneId); setH(n); setAutre(null); onEnregistre?.(n)
      setMessage({ texte: a === null ? 'Automatique : d’après les pointages' : 'Enregistré' })
    } catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) } finally { setEnCours(false) }
  }

  // Comparaison indicative avec le régime (jour le plus fréquent du lundi au vendredi)
  const jourType = minutesJour?.slice(0, 5).filter((m) => m > 0).sort((x, y) =>
    minutesJour.filter((m) => m === y).length - minutesJour.filter((m) => m === x).length)[0]
  const presence = choisi ? choisi[1] - choisi[0] - (choisi[1] - choisi[0] > 360 ? PAUSE : 0) : null
  const ecart = jourType && presence !== null ? presence - jourType : 0

  if (!h.modifiable) return <p className="petit" style={{ margin: 0 }}><strong>{choisi ? etiquetteHoraire(...choisi) : 'Automatique'}</strong>
    <span className="doux"> · défini par la RH ou le responsable</span></p>

  return (
    <div className="horaire-habituel">
      <div className="puces horaires" role="group" aria-label="Horaires habituels">
        <button className="puce" aria-pressed={!choisi && !autre} disabled={enCours} onClick={() => enregistrer(null, null)}
                title="L’outil retient tes heures habituelles d’après tes pointages">Automatique</button>
        {HORAIRES_COURANTS.map(([a, d]) => (
          <button key={a + '-' + d} className="puce" disabled={enCours} aria-pressed={!autre && !!choisi && choisi[0] === a && choisi[1] === d}
                  onClick={() => enregistrer(a, d)}>{etiquetteHoraire(a, d)}</button>
        ))}
        <button className="puce" aria-pressed={!!autre || (!!choisi && !courant)} aria-expanded={!!autre} disabled={enCours}
                onClick={() => setAutre(autre ? null : { a: hhmm(choisi?.[0] ?? h.utilise_arrivee), d: hhmm(choisi?.[1] ?? h.utilise_depart) })}>
          {choisi && !courant && !autre ? etiquetteHoraire(...choisi) : 'Autre…'}</button>
      </div>

      {autre && (
        <form className="horaire-libre" onSubmit={(e) => { e.preventDefault(); enregistrer(versMin(autre.a), versMin(autre.d)) }}>
          <label className="champ">Arrivée<input type="time" step={300} value={autre.a} required onChange={(e) => setAutre({ ...autre, a: e.target.value })} /></label>
          <label className="champ">Départ<input type="time" step={300} value={autre.d} required onChange={(e) => setAutre({ ...autre, d: e.target.value })} /></label>
          <button className="bouton" disabled={enCours || !autre.a || !autre.d || versMin(autre.d) <= versMin(autre.a)}>Enregistrer</button>
          {autre.a && autre.d && versMin(autre.d) <= versMin(autre.a) && <span className="petit negatif">Le départ doit suivre l’arrivée.</span>}
        </form>
      )}

      <p className="doux petit" style={{ margin: 0 }}>
        {choisi ? <>Retenu : <strong>{etiquetteHoraire(...choisi)}</strong>.</>
          : <>Automatique : actuellement <strong>{etiquetteHoraire(h.utilise_arrivee, h.utilise_depart)}</strong>, d’après {moi ? 'tes' : 'ses'} pointages (ou par défaut).</>}
        {' '}Sert aux rappels et à l’heure proposée quand {moi ? 'tu corriges' : 'on corrige'} un oubli. Les heures dues restent celles du régime.
      </p>
      {ecart !== 0 && Math.abs(ecart) >= 15 && presence !== null && jourType && (
        <p className="petit attention" style={{ margin: 0 }}>Cet horaire fait {duree(presence)} hors pause ; {moi ? 'ton' : 'son'} régime prévoit {duree(jourType)} par jour
          ({ecart > 0 ? `+${duree(ecart)}` : `−${duree(-ecart)}`}).</p>
      )}
      {message && <p className={`petit statut-inline ${message.erreur ? 'negatif' : 'positif'}`} role="status" style={{ margin: 0 }}>
        {!message.erreur && <IcCheck size={14} />}{message.texte}</p>}
    </div>
  )
}
