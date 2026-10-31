import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Api, CodeAbsence, Demande, Profil, SaisieDemande, Simulation, Solde, TypeDemande } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, decalerJour, duree, jourBxl } from '../lib/temps'

const STATUTS: Record<Demande['statut'], [string, string]> = {
  en_attente: ['En attente', 'attente'], accordee: ['Accordée', 'ok'], refusee: ['Refusée', 'ko'], annulee: ['Annulée', 'neutre'],
}

export default function Conges({ api, profil }: { api: Api; profil: Profil }) {
  const [soldes, setSoldes] = useState<Solde[] | null>(null)
  const [codes, setCodes] = useState<CodeAbsence[]>([])
  const [mes, setMes] = useState<Demande[] | null>(null)
  const [aValider, setAValider] = useState<Demande[]>([])
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null)

  // Minutes d'une journée « moyenne » du régime, pour afficher les soldes aussi en jours
  const jourMoyen = useMemo(() => {
    const j = (profil.minutes_jour ?? []).filter((m) => m > 0)
    return j.length ? j.reduce((a, b) => a + b, 0) / j.length : 456
  }, [profil])
  const enJours = (min: number) => {
    const j = Math.round((min / jourMoyen) * 10) / 10
    return `${String(j).replace('.', ',')} j`
  }

  const charger = useCallback(async () => {
    try {
      const [s, m, v] = await Promise.all([api.soldes(), api.mesDemandes(), api.aValider()])
      setSoldes(s); setMes(m); setAValider(v)
    } catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) }
  }, [api])

  useEffect(() => { charger(); api.codesAbsence().then((c) => setCodes(c.filter((x) => x.demandable))).catch(() => {}) }, [api, charger])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), message.erreur ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [message])

  // Solde courant par compteur (période la plus récente déjà commencée)
  const soldesCourants = useMemo(() => {
    const auj = jourBxl(), vus = new Set<string>()
    return (soldes ?? []).filter((s) => {
      if (s.periode_debut > auj || vus.has(s.compteur_code)) return false
      vus.add(s.compteur_code); return true
    }).sort((a, b) => a.ordre - b.ordre)
  }, [soldes])

  const blocSoldes = (classe: string) => (
        <section className={`carte ${classe}`}>
        <h2>Mes soldes</h2>
        {soldes === null && <p className="vide">Chargement…</p>}
        {soldes !== null && soldesCourants.length === 0 && <p className="vide">Aucun solde encodé. La RH les ajoute au démarrage.</p>}
        {soldesCourants.map((s) => {
          const ratio = s.attribue_min > 0 ? Math.min(100, Math.max(0, (s.pris_min / s.attribue_min) * 100)) : 0
          return (
            <div key={s.compteur_code} className="solde">
              <div className="ligne entre">
                <span className="solde-nom">{s.libelle}</span>
                <span className={`solde-reste ${s.reste_min < 0 ? 'negatif' : ''}`}>{enJours(s.reste_min)}</span>
              </div>
              <div className="barre fine"><span style={{ width: `${ratio}%` }} /></div>
              <div className="doux petit">{duree(s.reste_min)} restantes · {duree(s.pris_min)} prises sur {duree(s.attribue_min)}</div>
            </div>
          )
        })}
      </section>
  )

  return (
    <main className="contenu">
      <div className="col-principale pile">
        {aValider.length > 0 && (
          <AValider demandes={aValider} enJours={enJours}
                    onDecider={async (ids, accorder, commentaire) => {
                      try {
                        const n = await api.decider(ids, accorder, commentaire)
                        setMessage({ texte: `${n} demande(s) ${accorder ? 'accordée(s) ✅' : 'refusée(s)'}` }); await charger()
                      } catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) }
                    }} />
        )}

        {blocSoldes('mobile-seulement')}

        <NouvelleDemande api={api} codes={codes} enJours={enJours}
                         onEnvoyee={async () => { setMessage({ texte: 'Demande envoyée à ton responsable ✅' }); await charger() }}
                         onErreur={(t) => setMessage({ texte: t, erreur: true })} />

        <section className="carte">
          <h2>Mes demandes</h2>
          {mes === null && <p className="vide">Chargement…</p>}
          {mes?.length === 0 && <p className="vide">Aucune demande pour l’instant.</p>}
          <ul className="liste">
            {mes?.map((d) => (
              <LigneDemande key={d.id} d={d} enJours={enJours}
                            onAnnuler={async () => {
                              try { await api.annulerDemande(d.id); setMessage({ texte: 'Demande annulée' }); await charger() }
                              catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) }
                            }} />
            ))}
          </ul>
        </section>
      </div>

      <div className="col-laterale pile">
        {blocSoldes('pc-seulement')}
      </div>

      {message && <div className={`toast ${message.erreur ? 'erreur' : ''}`} role="status">{message.texte}</div>}
    </main>
  )
}

// ---------------------------------------------------------------------------
function prochainJourOuvre(): string {
  let j = decalerJour(jourBxl(), 1)
  while ([0, 6].includes(new Date(`${j}T12:00:00Z`).getUTCDay())) j = decalerJour(j, 1)
  return j
}

function NouvelleDemande({ api, codes, enJours, onEnvoyee, onErreur }: {
  api: Api; codes: CodeAbsence[]; enJours: (m: number) => string
  onEnvoyee: () => Promise<void>; onErreur: (t: string) => void
}) {
  const [type, setType] = useState<TypeDemande>('conge_jours')
  const [code, setCode] = useState('CP')
  const [debut, setDebut] = useState(prochainJourOuvre)
  const [fin, setFin] = useState(prochainJourOuvre)
  const [demi, setDemi] = useState<'matin' | 'apres_midi'>('matin')
  const [heures, setHeures] = useState(2)
  const [minutes, setMinutes] = useState(0)
  const [commentaire, setCommentaire] = useState('')
  const [sim, setSim] = useState<Simulation | null>(null)
  const [enCours, setEnCours] = useState(false)

  const saisie: SaisieDemande = useMemo(() => ({
    type, code_absence: code, debut, fin: type === 'conge_jours' ? (fin < debut ? debut : fin) : debut,
    demi: type === 'conge_demi_jour' ? demi : null,
    minutes: type === 'conge_heures' ? heures * 60 + minutes : null,
    commentaire: commentaire.trim() || null,
  }), [type, code, debut, fin, demi, heures, minutes, commentaire])

  // Simulation en direct (solde après la demande + collègues absents)
  useEffect(() => {
    if (!debut || !code || (type === 'conge_heures' && heures * 60 + minutes === 0)) { setSim(null); return }
    let actif = true
    const t = setTimeout(() => {
      api.simuler({ ...saisie, commentaire: null }).then((s) => { if (actif) setSim(s) }).catch(() => { if (actif) setSim(null) })
    }, 250)
    return () => { actif = false; clearTimeout(t) }
  }, [api, saisie, debut, code, type, heures, minutes])

  async function envoyer(e: React.FormEvent) {
    e.preventDefault()
    setEnCours(true)
    try {
      await api.soumettre(saisie)
      setCommentaire('')
      await onEnvoyee()
    } catch (err) { onErreur(messageErreur(err)) }
    finally { setEnCours(false) }
  }

  const aucunJour = sim !== null && sim.minutes === 0

  return (
    <section className="carte">
      <h2>Nouvelle demande</h2>
      <form onSubmit={envoyer}>
        <div className="segments" role="radiogroup" aria-label="Durée">
          {([['conge_jours', 'Jour(s)'], ['conge_demi_jour', '½ journée'], ['conge_heures', 'Heures']] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>

        <label className="champ">Type de congé
          <select id="code-absence" value={code} onChange={(e) => setCode(e.target.value)}>
            {codes.map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}
          </select>
        </label>

        <div className="champs-ligne">
          <label className="champ">{type === 'conge_jours' ? 'Du' : 'Le'}
            <input id="date-debut" type="date" value={debut} required
                   onChange={(e) => { setDebut(e.target.value); if (fin < e.target.value) setFin(e.target.value) }} />
          </label>
          {type === 'conge_jours' && (
            <label className="champ">Au
              <input id="date-fin" type="date" value={fin} min={debut} required onChange={(e) => setFin(e.target.value)} />
            </label>
          )}
          {type === 'conge_demi_jour' && (
            <label className="champ">Moment
              <select id="demi" value={demi} onChange={(e) => setDemi(e.target.value as 'matin' | 'apres_midi')}>
                <option value="matin">Matin</option><option value="apres_midi">Après-midi</option>
              </select>
            </label>
          )}
          {type === 'conge_heures' && (
            <label className="champ">Durée
              <span className="ligne">
                <select id="heures" value={heures} onChange={(e) => setHeures(Number(e.target.value))} aria-label="Heures">
                  {Array.from({ length: 8 }, (_, h) => <option key={h} value={h}>{h} h</option>)}
                </select>
                <select id="minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Minutes">
                  {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                </select>
              </span>
            </label>
          )}
        </div>

        {sim && (
          <div className={`simulation ${sim.solde_negatif || sim.seuil_depasse || aucunJour ? 'alerte' : ''}`} aria-live="polite">
            {aucunJour
              ? <strong>Aucune heure prévue sur cette période (week-end, férié ou jour non presté).</strong>
              : <>
                  <div><strong>Décompte : {enJours(sim.minutes)}</strong> <span className="doux">({duree(sim.minutes)})</span></div>
                  {sim.solde_apres !== null && (
                    <div className={sim.solde_negatif ? 'negatif' : ''}>
                      Il te restera <strong>{enJours(sim.solde_apres)}</strong> ({duree(sim.solde_apres)})
                      {sim.solde_negatif && ' — solde négatif, ton responsable sera prévenu'}
                    </div>
                  )}
                  <div className={sim.seuil_depasse ? 'attention' : 'doux'}>
                    {sim.collegues_absents === 0
                      ? 'Personne d’autre de ton service n’est absent sur cette période.'
                      : `${sim.collegues_absents} collègue(s) de ton service ${sim.collegues_absents > 1 ? 'sont' : 'est'} déjà absent(s) sur cette période`
                        + (sim.seuil_depasse ? ' — seuil d’absence du service dépassé.' : '.')}
                  </div>
                </>}
          </div>
        )}

        <label className="champ">Commentaire (facultatif)
          <input id="commentaire" value={commentaire} maxLength={1000} placeholder="Ex. vacances en famille"
                 onChange={(e) => setCommentaire(e.target.value)} />
        </label>
        <button className="bouton large" disabled={enCours || aucunJour}>{enCours ? 'Envoi…' : 'Envoyer la demande'}</button>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
function periode(d: Demande): string {
  if (d.type === 'conge_demi_jour') return `${dateCourte(d.date_debut)} ${d.demi === 'matin' ? 'matin' : 'après-midi'}`
  if (d.date_debut === d.date_fin) return dateCourte(d.date_debut)
  return `${dateCourte(d.date_debut)} → ${dateCourte(d.date_fin)}`
}

function LigneDemande({ d, enJours, onAnnuler }: { d: Demande; enJours: (m: number) => string; onAnnuler: () => Promise<void> }) {
  const [confirmer, setConfirmer] = useState(false)
  const [libelle, classe] = STATUTS[d.statut]
  const annulable = d.statut === 'en_attente' || (d.statut === 'accordee' && d.date_debut > jourBxl())
  return (
    <li>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div><strong>{d.libelle_absence}</strong> · {periode(d)}</div>
        <div className="doux petit">{d.type === 'conge_heures' ? duree(d.minutes_decomptees) : enJours(d.minutes_decomptees)}
          {d.commentaire_decision && ` · « ${d.commentaire_decision} »`}</div>
      </div>
      <span className={`pilule ${classe}`}>{libelle}</span>
      {annulable && (confirmer
        ? <span className="ligne"><button className="bouton danger petit" onClick={onAnnuler}>Confirmer</button>
            <button className="lien petit" onClick={() => setConfirmer(false)}>Non</button></span>
        : <button className="lien petit" onClick={() => setConfirmer(true)}>Annuler</button>)}
    </li>
  )
}

// ---------------------------------------------------------------------------
function AValider({ demandes, enJours, onDecider }: {
  demandes: Demande[]; enJours: (m: number) => string
  onDecider: (ids: string[], accorder: boolean, commentaire?: string) => Promise<void>
}) {
  const [choisies, setChoisies] = useState<Set<string>>(new Set())
  const [refus, setRefus] = useState<string | null>(null)   // motif en cours de saisie
  const [enCours, setEnCours] = useState(false)

  useEffect(() => { setChoisies(new Set(demandes.map((d) => d.id))) }, [demandes])

  const basculer = (id: string) => setChoisies((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const ids = [...choisies]
  const decider = async (accorder: boolean) => {
    setEnCours(true)
    await onDecider(ids, accorder, accorder ? undefined : refus ?? undefined)
    setEnCours(false); setRefus(null)
  }
  const anciennete = (d: Demande) => Math.floor((Date.now() - Date.parse(d.cree_le)) / 86_400_000)

  return (
    <section className="carte a-valider">
      <div className="ligne entre"><h2>À valider</h2><span className="pilule attente">{demandes.length}</span></div>
      <ul className="liste">
        {demandes.map((d) => (
          <li key={d.id}>
            <input type="checkbox" id={`v-${d.id}`} checked={choisies.has(d.id)} onChange={() => basculer(d.id)} />
            <label htmlFor={`v-${d.id}`} style={{ flex: 1, minWidth: 0 }}>
              <strong>{d.prenom} {d.nom}</strong> · {d.libelle_absence}
              <div className="doux petit">{periode(d)} · {d.type === 'conge_heures' ? duree(d.minutes_decomptees) : enJours(d.minutes_decomptees)}
                {d.commentaire && ` · « ${d.commentaire} »`}
                {anciennete(d) >= 3 && <span className="attention"> · en attente depuis {anciennete(d)} j</span>}</div>
            </label>
          </li>
        ))}
      </ul>
      {refus === null ? (
        <div className="actions">
          <button className="bouton secondaire" disabled={!ids.length || enCours} onClick={() => setRefus('')}>Refuser</button>
          <button className="bouton" disabled={!ids.length || enCours} onClick={() => decider(true)}>
            Accepter {ids.length > 1 ? `les ${ids.length}` : ''}</button>
        </div>
      ) : (
        <div>
          <label className="champ">Motif du refus (obligatoire, visible par la personne)
            <input id="motif-refus" value={refus} autoFocus maxLength={1000} onChange={(e) => setRefus(e.target.value)}
                   placeholder="Ex. trop d’absences cette semaine-là" />
          </label>
          <div className="actions">
            <button className="bouton secondaire" onClick={() => setRefus(null)}>Retour</button>
            <button className="bouton danger" disabled={!refus.trim() || enCours} onClick={() => decider(false)}>
              Refuser {ids.length > 1 ? `les ${ids.length}` : ''}</button>
          </div>
        </div>
      )}
    </section>
  )
}
