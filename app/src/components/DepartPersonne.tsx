import { useState } from 'react'
import type { Api, ApercuDepart } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, duree, jourBxl } from '../lib/temps'
import { IcAttention, IcCheck } from './Icones'

/**
 * Départ d'une personne (offboarding) : on choisit la date, on voit l'impact, on confirme.
 * Rien n'est supprimé : l'historique reste ; l'accès s'arrête de lui-même le lendemain de la date de sortie.
 */
export default function DepartPersonne({ api, personneId, nom, dateSortie, onFait }: {
  api: Api; personneId: string; nom: string; dateSortie: string | null; onFait: (texte: string, erreur?: boolean) => void
}) {
  const [date, setDate] = useState(jourBxl())
  const [apercu, setApercu] = useState<ApercuDepart | null>(null)
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)

  if (dateSortie) {
    const passe = dateSortie < jourBxl()
    return (
      <div>
        <p className="petit" style={{ marginTop: 0 }}>{passe ? 'Partie le' : 'Départ prévu le'} <strong>{dateCourte(dateSortie)}</strong>.
          {passe ? ' Son historique est conservé ; elle ne peut plus se connecter.' : ' Elle garde l’accès jusqu’à cette date incluse.'}</p>
        <button className="bouton secondaire" onClick={async () => {
          try { await api.annulerDepart(personneId); onFait('Départ annulé') } catch (e) { onFait(messageErreur(e), true) }
        }}>{passe ? 'Réintégrer (annuler le départ)' : 'Annuler le départ'}</button>
      </div>
    )
  }

  if (!ouvert) return <button className="bouton secondaire" onClick={() => setOuvert(true)}>Préparer le départ</button>
  return (
    <div className="depart">
      <label className="champ" style={{ marginTop: 0 }}>Dernier jour de travail
        <input id="depart-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setApercu(null) }} /></label>
      {!apercu ? (
        <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
          <button className="bouton" disabled={enCours} onClick={async () => {
            setEnCours(true)
            try { setApercu(await api.preparerDepart(personneId, date)) } catch (e) { onFait(messageErreur(e), true) } finally { setEnCours(false) }
          }}>Voir ce qui change</button>
          <button className="bouton secondaire" onClick={() => setOuvert(false)}>Annuler</button>
        </div>
      ) : (
        <>
          <ul className="controle">
            <li className="ok"><span><IcCheck size={14} /></span>Accès coupé automatiquement après le {dateCourte(date)} ; historique et pointages conservés.</li>
            {apercu.soldes.length > 0
              ? <li className="ko"><span><IcAttention size={14} /></span>Soldes à communiquer au secrétariat social : {apercu.soldes.map((s) => `${s.compteur} ${duree(s.reste_min)}`).join(' · ')}</li>
              : <li className="ok"><span><IcCheck size={14} /></span>Aucun solde restant.</li>}
            {apercu.demandes_apres > 0 && <li className="ko"><span><IcAttention size={14} /></span>{apercu.demandes_apres} demande(s) de congé après le départ : elles seront annulées.</li>}
            {apercu.chef_de.length > 0 && <li className="ko"><span><IcAttention size={14} /></span>Chef de service ({apercu.chef_de.join(', ')}) : désigne son remplaçant dans Réglages › Services.</li>}
            {apercu.demandes_a_valider > 0 && <li className="ko"><span><IcAttention size={14} /></span>{apercu.demandes_a_valider} demande(s) attendent sa validation : à traiter avant son départ.</li>}
          </ul>
          <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
            <button className="bouton danger" disabled={enCours} onClick={async () => {
              setEnCours(true)
              try { const r = await api.enregistrerDepart(personneId, date); onFait(`Départ de ${nom} enregistré${r.demandes_annulees ? ` · ${r.demandes_annulees} demande(s) annulée(s)` : ''}`) }
              catch (e) { onFait(messageErreur(e), true) } finally { setEnCours(false) }
            }}>Enregistrer le départ</button>
            <button className="bouton secondaire" onClick={() => { setOuvert(false); setApercu(null) }}>Annuler</button>
          </div>
        </>
      )}
    </div>
  )
}
