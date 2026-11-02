import { useCallback, useEffect, useState } from 'react'
import type { Api, MouvementCompteur, Solde } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, duree } from '../lib/temps'

const TYPES: Record<string, string> = {
  ouverture: 'Ouverture', attribution: 'Attribution', prise: 'Congé pris', annulation: 'Congé annulé', ajustement: 'Ajustement RH',
  report: 'Report', expiration: 'Expiré', hs_validees: 'Heures en récup',
}
const enMin = (v: string) => { const [h, m] = (v || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

/** Soldes d'une personne (RH) : reste par compteur, ajustement motivé, historique complet (qui, quand, pourquoi). */
export default function SoldesPersonne({ api, personneId, onMessage }: { api: Api; personneId: string; onMessage: (t: string, erreur?: boolean) => void }) {
  const [soldes, setSoldes] = useState<Solde[] | null>(null)
  const [histo, setHisto] = useState<MouvementCompteur[]>([])
  const [voirHisto, setVoirHisto] = useState(false)
  const [ajout, setAjout] = useState<{ compteur: string; sens: 1 | -1; heures: string; motif: string } | null>(null)
  const charger = useCallback(() => {
    api.soldesPersonne(personneId).then(setSoldes).catch(() => setSoldes([]))
    api.mouvementsPersonne(personneId).then(setHisto).catch(() => setHisto([]))
  }, [api, personneId])
  useEffect(() => { charger() }, [charger])

  // Solde courant : la période la plus récente de chaque compteur
  const courants = (soldes ?? []).filter((s, i, t) => t.findIndex((x) => x.compteur_code === s.compteur_code) === i)

  return (
    <div className="soldes-personne">
      {soldes === null && <p className="vide">Chargement…</p>}
      {soldes?.length === 0 && <p className="doux petit">Aucun solde encodé.</p>}
      <ul className="liste compacte">{courants.map((s) => (
        <li key={s.compteur_code}><span className="texte-ligne">{s.libelle}<span className="doux petit"> · {duree(s.pris_min)} pris sur {duree(s.attribue_min)}</span></span>
          <strong className={s.reste_min < 0 ? 'negatif' : ''}>{duree(s.reste_min)}</strong></li>
      ))}</ul>
      {ajout ? (
        <form className="ajustement" onSubmit={async (e) => {
          e.preventDefault()
          const min = enMin(ajout.heures) * ajout.sens
          if (!min) return onMessage('Indique une durée', true)
          try { await api.ajusterSolde(personneId, ajout.compteur, min, ajout.motif); setAjout(null); onMessage('Solde ajusté'); charger() }
          catch (err) { onMessage(messageErreur(err), true) }
        }}>
          <div className="champs-ligne">
            <label className="champ">Compteur
              <select id="aj-compteur" value={ajout.compteur} onChange={(e) => setAjout({ ...ajout, compteur: e.target.value })}>
                {courants.map((s) => <option key={s.compteur_code} value={s.compteur_code}>{s.libelle}</option>)}</select></label>
            <label className="champ">Durée
              <span className="ligne">
                <span className="segments compact" role="radiogroup" aria-label="Sens">
                  <button type="button" role="radio" aria-checked={ajout.sens === 1} onClick={() => setAjout({ ...ajout, sens: 1 })}>Ajouter</button>
                  <button type="button" role="radio" aria-checked={ajout.sens === -1} onClick={() => setAjout({ ...ajout, sens: -1 })}>Retirer</button>
                </span>
                <input id="aj-heures" type="time" value={ajout.heures} onChange={(e) => setAjout({ ...ajout, heures: e.target.value })} required aria-label="Heures" />
              </span></label>
          </div>
          <label className="champ">Motif (obligatoire)<input id="aj-motif" value={ajout.motif} required onChange={(e) => setAjout({ ...ajout, motif: e.target.value })} placeholder="Ex. correction du solde repris de Dinclock" /></label>
          <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
            <button className="bouton">Enregistrer</button><button type="button" className="bouton secondaire" onClick={() => setAjout(null)}>Annuler</button></div>
        </form>
      ) : (
        <div className="ligne">
          {courants.length > 0 && <button className="bouton secondaire petit" onClick={() => setAjout({ compteur: courants[0].compteur_code, sens: 1, heures: '07:36', motif: '' })}>Ajuster un solde</button>}
          {histo.length > 0 && <button className="lien petit" aria-expanded={voirHisto} onClick={() => setVoirHisto((v) => !v)}>{voirHisto ? 'Masquer' : 'Voir'} l’historique ({histo.length})</button>}
        </div>
      )}
      {voirHisto && (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Date</th><th>Compteur</th><th>Mouvement</th><th className="num">Durée</th><th className="masque-mobile">Par</th></tr></thead>
            <tbody>{histo.map((m) => (
              <tr key={m.id}><td>{dateCourte(m.date_effet)}</td><td>{m.compteur}</td>
                <td>{TYPES[m.type] ?? m.type}{m.motif && <div className="doux petit">{m.motif}</div>}</td>
                <td className={`num ${m.minutes < 0 ? 'negatif' : 'positif'}`}>{duree(m.minutes, true)}</td><td className="masque-mobile petit">{m.par}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
