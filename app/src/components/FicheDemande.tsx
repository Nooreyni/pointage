import { useEffect, useMemo, useState } from 'react'
import Fenetre from './Fenetre'
import Justificatif from './Justificatif'
import { IcPrecedent, IcSuivant } from './Icones'
import { LienPersonne } from '../lib/navigation'
import type { Api, CodeAbsence, Demande, PersonneVisible, Solde } from '../lib/types'
import { dateCourte, duree, jourBxl } from '../lib/temps'

const TYPES: Record<Demande['type'], string> = { conge_jours: 'Jour(s) entier(s)', conge_demi_jour: 'Demi-journée', conge_heures: 'Heures' }

/**
 * Fiche d'une demande à valider : tout ce qu'il faut pour décider (période, solde avant / après,
 * collègues du même service absents ces jours-là), puis Accepter, Refuser (motif) ou Fermer.
 * Navigation entre les demandes en attente sans repasser par la liste.
 */
export default function FicheDemande({ api, demandes, index, codes, enJours, onIndex, onDecider, onFermer, onMessage }: {
  api: Api; demandes: Demande[]; index: number; codes: CodeAbsence[]; enJours: (m: number) => string
  onIndex: (i: number) => void; onDecider: (d: Demande, accorder: boolean, motif?: string) => Promise<boolean>
  onFermer: () => void; onMessage: (t: string, erreur?: boolean) => void
}) {
  const d = demandes[index]
  const [soldes, setSoldes] = useState<Solde[] | null>(null)
  const [equipe, setEquipe] = useState<{ absents: Demande[]; service: string | null; effectif: number } | null>(null)
  const [refus, setRefus] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    if (!d) return
    setSoldes(null); setEquipe(null); setRefus(null)
    api.soldesPersonne(d.personne_id).then(setSoldes).catch(() => setSoldes([]))
    Promise.all([api.personnesVisibles(), api.demandesEquipe(d.date_debut, d.date_fin)]).then(([ps, ds]) => {
      const service = ps.find((p: PersonneVisible) => p.id === d.personne_id)?.service ?? null
      const memeService = new Set(ps.filter((p) => p.service === service).map((p) => p.id))
      const absents = ds.filter((x) => x.id !== d.id && x.personne_id !== d.personne_id && memeService.has(x.personne_id)
        && ['accordee', 'en_attente'].includes(x.statut) && x.date_debut <= d.date_fin && x.date_fin >= d.date_debut)
      setEquipe({ absents, service, effectif: memeService.size })
    }).catch(() => setEquipe({ absents: [], service: null, effectif: 0 }))
  }, [api, d])

  const compteur = codes.find((c) => c.code === d?.code_absence)?.compteur_code ?? null
  const solde = useMemo(() => {
    if (!compteur || !soldes) return null
    const auj = jourBxl()
    return soldes.filter((s) => s.compteur_code === compteur && s.periode_debut <= (d?.date_debut ?? auj)).sort((a, b) => b.periode_debut.localeCompare(a.periode_debut))[0] ?? null
  }, [soldes, compteur, d])

  if (!d) return null
  const attente = Math.floor((Date.now() - Date.parse(d.cree_le)) / 86_400_000)
  const apres = solde ? solde.reste_min - d.minutes_decomptees : null
  const decider = async (accorder: boolean) => {
    setEnCours(true)
    const ok = await onDecider(d, accorder, accorder ? undefined : refus?.trim())
    setEnCours(false)
    if (ok) setRefus(null)
  }

  return (
    <Fenetre titre={`Demande de ${d.prenom} ${d.nom}`} onFermer={onFermer} large>
      {demandes.length > 1 && (
        <div className="nav-demandes">
          <button className="bouton secondaire petit" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Demande précédente"><IcPrecedent size={16} /></button>
          <span className="doux petit">{index + 1} sur {demandes.length} en attente</span>
          <button className="bouton secondaire petit" disabled={index === demandes.length - 1} onClick={() => onIndex(index + 1)} aria-label="Demande suivante"><IcSuivant size={16} /></button>
        </div>
      )}

      <dl className="resume-demande">
        <div><dt>Personne</dt><dd><LienPersonne id={d.personne_id} nom={`${d.prenom} ${d.nom}`} vers="temps" />{equipe?.service && <span className="doux"> · {equipe.service}</span>}</dd></div>
        <div><dt>Motif</dt><dd>{d.libelle_absence} <span className="doux">· {TYPES[d.type]}</span></dd></div>
        <div><dt>Période</dt><dd>{d.date_debut === d.date_fin ? dateCourte(d.date_debut) : `${dateCourte(d.date_debut)} → ${dateCourte(d.date_fin)}`}
          {d.demi ? (d.demi === 'matin' ? ' · matin' : ' · après-midi') : ''}</dd></div>
        <div><dt>Décompté</dt><dd><strong>{duree(d.minutes_decomptees)}</strong>{d.type !== 'conge_heures' && <span className="doux"> (≈ {enJours(d.minutes_decomptees)})</span>}</dd></div>
        <div><dt>Demandée le</dt><dd>{dateCourte(d.cree_le.slice(0, 10))}{attente >= 1 && <span className={`sans-coupure ${attente >= 3 ? 'attention' : 'doux'}`}> · en attente depuis {attente} j</span>}</dd></div>
        {d.commentaire && <div className="pleine"><dt>Message</dt><dd className="message-demande">« {d.commentaire} »</dd></div>}
        {d.justificatif_requis !== undefined && (d.justificatif_requis || d.justificatif_joint) && (
          <div className="pleine"><dt>Justificatif</dt><dd><Justificatif api={api} d={d} peutDeposer={false} onChange={onMessage} /></dd></div>)}
      </dl>

      <div className="blocs-decision">
        <section>
          <h3 className="titre-bloc">Solde {solde ? `· ${solde.libelle}` : ''}</h3>
          {!compteur ? <p className="doux petit">Ce motif ne décompte d’aucun solde.</p>
            : soldes === null ? <p className="vide">Chargement…</p>
            : !solde ? <p className="doux petit">Solde non disponible.</p>
            : <div className="avant-apres">
                <span><small className="doux">Avant</small><strong>{duree(solde.reste_min)}</strong></span>
                <span aria-hidden="true">→</span>
                <span><small className="doux">Après</small><strong className={apres! < 0 ? 'negatif' : ''}>{duree(apres!)}</strong></span>
                {apres! < 0 && <p className="attention petit pleine">Le solde deviendrait négatif.</p>}
              </div>}
        </section>
        <section>
          <h3 className="titre-bloc">Équipe ces jours-là</h3>
          {equipe === null ? <p className="vide">Chargement…</p>
            : equipe.absents.length === 0 ? <p className="positif petit">Personne d’autre du service n’est absent.</p>
            : <>
                <p className="petit" style={{ marginTop: 0 }}><strong>{equipe.absents.length}</strong> autre(s) absence(s){equipe.effectif ? ` sur ${equipe.effectif} personnes` : ''} :</p>
                <ul className="liste compacte">{equipe.absents.map((x) => (
                  <li key={x.id}><span className="texte-ligne">{x.prenom} {x.nom} <span className="doux">· {x.date_debut === x.date_fin ? dateCourte(x.date_debut) : `${dateCourte(x.date_debut)} → ${dateCourte(x.date_fin)}`}</span></span>
                    <span className={`pilule ${x.statut === 'accordee' ? 'ok' : 'attente'}`}>{x.statut === 'accordee' ? 'Accordé' : 'En attente'}</span></li>
                ))}</ul>
              </>}
        </section>
      </div>

      {refus === null ? (
        <div className="actions">
          <button className="bouton secondaire" onClick={onFermer}>Fermer</button>
          <button className="bouton secondaire bouton-refus" disabled={enCours} onClick={() => setRefus('')}>Refuser</button>
          <button className="bouton" disabled={enCours} onClick={() => decider(true)}>{enCours ? 'Envoi…' : 'Accepter'}</button>
        </div>
      ) : (
        <div className="refus">
          <label className="champ">Motif du refus (obligatoire, visible par la personne)
            <input id="fiche-motif-refus" value={refus} autoFocus maxLength={1000} onChange={(e) => setRefus(e.target.value)} placeholder="Ex. trop d’absences cette semaine-là" /></label>
          <div className="actions">
            <button className="bouton secondaire" onClick={() => setRefus(null)}>Retour</button>
            <button className="bouton danger" disabled={!refus.trim() || enCours} onClick={() => decider(false)}>Refuser la demande</button>
          </div>
        </div>
      )}
      <p className="doux petit" style={{ marginBottom: 0 }}>Ta décision est définitive et la personne est prévenue.</p>
    </Fenetre>
  )
}
