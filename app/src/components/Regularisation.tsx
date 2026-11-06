import { useState } from 'react'
import type { Anomalie, CodeAbsence, Personne, Sens, TypeDemande } from '../lib/types'
import { dateCourte, hhmm, jourBxl } from '../lib/temps'
import Fenetre from './Fenetre'
import { useDialogue } from './useDialogue'

/**
 * Fenêtres de régularisation partagées : correction d'un oubli par la personne elle-même (Pointer, Mon mois) ;
 * ajout d'heures et encodage d'une absence par la RH (Suivi RH, fiche de temps).
 */
const enMinutes = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }

export function FenetrePointage({ personne, jour, incomplet, onFermer, onValider }: {
  personne: Personne; jour: string; incomplet: boolean; onFermer: () => void
  onValider: (c: ['entree' | 'sortie', number][], motif: string) => Promise<void>
}) {
  const [entree, setEntree] = useState(hhmm(510))
  const [sortie, setSortie] = useState(hhmm(1020))
  const [motif, setMotif] = useState('')
  const [enCours, setEnCours] = useState(false)
  return (
    <Fenetre titre={`${personne.prenom} ${personne.nom} — ${dateCourte(jour)}`} onFermer={onFermer}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setEnCours(true)
        await onValider(incomplet ? [['sortie', enMinutes(sortie)]] : [['entree', enMinutes(entree)], ['sortie', enMinutes(sortie)]], motif)
        setEnCours(false)
      }}>
        <p className="doux petit">Correction RH : ajoutée immédiatement et tracée dans le journal d’audit.</p>
        {!incomplet && <label className="champ">Entrée<input id="rh-entree" type="time" value={entree} onChange={(e) => setEntree(e.target.value)} required /></label>}
        <label className="champ">Sortie<input id="rh-sortie" type="time" value={sortie} onChange={(e) => setSortie(e.target.value)} required /></label>
        <label className="champ">Motif<input id="rh-motif" value={motif} maxLength={500} placeholder="Ex. confirmé par le chef de service"
                                              onChange={(e) => setMotif(e.target.value)} /></label>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onFermer}>Annuler</button>
          <button className="bouton" disabled={enCours || (!incomplet && enMinutes(sortie) <= enMinutes(entree))}>{enCours ? 'Envoi…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Fenetre>
  )
}

export function FenetreAbsence({ personnes, codes, personne, jour, onFermer, onValider }: {
  personnes: Personne[]; codes: CodeAbsence[]; personne?: Personne; jour?: string; onFermer: () => void
  onValider: (personneId: string, s: { type: TypeDemande; code_absence: string; debut: string; fin: string;
                                         demi: 'matin' | 'apres_midi' | null; minutes: number | null; commentaire: string | null }) => Promise<void>
}) {
  const [personneId, setPersonneId] = useState(personne?.id ?? '')
  const [code, setCode] = useState('MAL')
  const [type, setType] = useState<TypeDemande>('conge_jours')
  const [debut, setDebut] = useState(jour ?? jourBxl())
  const [fin, setFin] = useState(jour ?? jourBxl())
  const [demi, setDemi] = useState<'matin' | 'apres_midi'>('matin')
  const [heures, setHeures] = useState('02:00')
  const [commentaire, setCommentaire] = useState('')
  const [enCours, setEnCours] = useState(false)
  // Codes encodés par la RH d'abord (maladie, AT…), puis les autres
  const tries = [...codes].sort((a, b) => Number(a.demandable) - Number(b.demandable) || a.ordre - b.ordre)

  return (
    <Fenetre titre="Encoder une absence" onFermer={onFermer}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setEnCours(true)
        await onValider(personneId, { type, code_absence: code, debut, fin: type === 'conge_jours' ? (fin < debut ? debut : fin) : debut,
                                      demi: type === 'conge_demi_jour' ? demi : null,
                                      minutes: type === 'conge_heures' ? enMinutes(heures) : null, commentaire: commentaire.trim() || null })
        setEnCours(false)
      }}>
        <label className="champ">Personne
          <select id="abs-personne" value={personneId} onChange={(e) => setPersonneId(e.target.value)} required>
            <option value="" disabled>Choisir…</option>
            {personnes.map((p) => <option key={p.id} value={p.id}>{p.nom} {p.prenom} — {p.service}</option>)}
          </select>
        </label>
        <label className="champ">Motif
          <select id="abs-code" value={code} onChange={(e) => setCode(e.target.value)}>
            {tries.map((c) => <option key={c.code} value={c.code}>{c.libelle}{c.code_court ? ` (${c.code_court})` : ''}</option>)}
          </select>
        </label>
        <div className="segments" role="radiogroup" aria-label="Durée">
          {([['conge_jours', 'Jour(s)'], ['conge_demi_jour', '½ journée'], ['conge_heures', 'Heures']] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>
        <div className="champs-ligne">
          <label className="champ">{type === 'conge_jours' ? 'Du' : 'Le'}
            <input id="abs-debut" type="date" value={debut} required onChange={(e) => { setDebut(e.target.value); if (fin < e.target.value) setFin(e.target.value) }} /></label>
          {type === 'conge_jours' && <label className="champ">Au<input id="abs-fin" type="date" value={fin} min={debut} required onChange={(e) => setFin(e.target.value)} /></label>}
          {type === 'conge_demi_jour' && <label className="champ">Moment
            <select id="abs-demi" value={demi} onChange={(e) => setDemi(e.target.value as 'matin' | 'apres_midi')}>
              <option value="matin">Matin</option><option value="apres_midi">Après-midi</option></select></label>}
          {type === 'conge_heures' && <label className="champ">Durée<input id="abs-heures" type="time" value={heures} onChange={(e) => setHeures(e.target.value)} /></label>}
        </div>
        <label className="champ">Commentaire (facultatif)
          <input id="abs-commentaire" value={commentaire} maxLength={1000} placeholder="Ex. certificat reçu le 03/11" onChange={(e) => setCommentaire(e.target.value)} /></label>
        <p className="doux petit">Le motif est visible par la RH, la direction et le N+1. Les collègues voient seulement « Absent ».</p>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onFermer}>Annuler</button>
          <button className="bouton" disabled={enCours || !personneId}>{enCours ? 'Envoi…' : 'Encoder'}</button>
        </div>
      </form>
    </Fenetre>
  )
}

export function Correction({ anomalie, hEntree, hSortie, onFermer, onValider }: {
  anomalie: Anomalie; hEntree: number; hSortie: number
  onFermer: () => void; onValider: (c: [Sens, number][], motif: string) => Promise<void>
}) {
  const absent = anomalie.code === 'absent'
  const [entree, setEntree] = useState(hhmm(hEntree))
  const [sortie, setSortie] = useState(hhmm(hSortie))
  const [motif, setMotif] = useState('')
  const [enCours, setEnCours] = useState(false)
  const min = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }
  const dialogue = useDialogue<HTMLFormElement>(onFermer)

  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-correction" onClick={onFermer}>
      <form className="fenetre" ref={dialogue} onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault(); setEnCours(true)
        await onValider(absent ? [['entree', min(entree)], ['sortie', min(sortie)]] : [['sortie', min(sortie)]], motif)
        setEnCours(false)
      }}>
        <h2 id="titre-correction">Corriger le {dateCourte(anomalie.jour)}</h2>
        <p className="doux petit">Heure proposée d’après tes habitudes. La correction est validée tout de suite ; ton responsable est informé.</p>
        {absent && <label className="champ">Heure d’entrée<input type="time" value={entree} onChange={(e) => setEntree(e.target.value)} required /></label>}
        <label className="champ">Heure de sortie<input type="time" value={sortie} onChange={(e) => setSortie(e.target.value)} required /></label>
        <label className="champ">Motif (facultatif)<input value={motif} maxLength={500} placeholder="Ex. oubli en partant" onChange={(e) => setMotif(e.target.value)} /></label>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onFermer}>Annuler</button>
          <button className="bouton" disabled={enCours || (absent && min(sortie) <= min(entree))}>{enCours ? 'Envoi…' : 'Enregistrer'}</button>
        </div>
      </form>
    </div>
  )
}
