import { useCallback, useEffect, useMemo, useState } from 'react'
import { IcAttention, IcCheck, IcChevron } from '../components/Icones'
import { Pagination, usePagination } from '../components/Pagination'
import { libelleChamp } from '../components/SignalerInfo'
import Toast from '../components/Toast'
import { LienPersonne, useNav } from '../lib/navigation'
import type { AnomalieRH, Api, Signalement, StatsDirection, CodeAbsence, Demande, EtatCloture, HeureAValider, Personne, PropositionConges,
  TypeDemande } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import Justificatif from '../components/Justificatif'
import { dateCourte, duree, hhmm, isoBxl, jourBxl } from '../lib/temps'
import Fenetre from '../components/Fenetre'

type Message = { texte: string; erreur?: boolean }
type Action = { type: 'pointage' | 'absence'; personne?: Personne; jour?: string; incomplet?: boolean } | null

const MOIS = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const nomMois = (iso: string) => MOIS.format(new Date(`${iso}T12:00:00Z`))
const moisPrecedent = () => { const d = new Date(`${jourBxl().slice(0, 8)}01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10) }
const JOUR_RH = 456 // affichage indicatif en jours (7h36)

export default function Rh({ api }: { api: Api }) {
  const [personnes, setPersonnes] = useState<Personne[]>([])
  const [anomalies, setAnomalies] = useState<AnomalieRH[] | null>(null)
  const [aConstater, setAConstater] = useState<Demande[]>([])
  const [heures, setHeures] = useState<HeureAValider[]>([])
  const [codes, setCodes] = useState<CodeAbsence[]>([])
  const [mois, setMois] = useState(moisPrecedent)
  const [etat, setEtat] = useState<EtatCloture | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [filtre, setFiltre] = useState('')
  const [service, setService] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)

  const erreur = useCallback((e: unknown) => setMessage({ texte: messageErreur(e), erreur: true }), [])
  const charger = useCallback(async () => {
    try {
      const [p, a, c, h] = await Promise.all([api.personnes(), api.anomaliesTous(), api.aConstater(), api.heuresAValider()])
      setPersonnes(p); setAnomalies(a); setAConstater(c); setHeures(h)
    } catch (e) { erreur(e) }
  }, [api, erreur])
  const chargerEtat = useCallback(() => { api.etatCloture(mois).then(setEtat).catch(erreur) }, [api, mois, erreur])

  useEffect(() => { charger(); api.codesAbsence().then(setCodes).catch(() => {}) }, [api, charger])
  useEffect(() => { chargerEtat() }, [chargerEtat])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), message.erreur ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [message])

  const toutRecharger = async (texte: string) => { setMessage({ texte }); await charger(); chargerEtat() }
  const parId = useMemo(() => new Map(personnes.map((p) => [p.id, p])), [personnes])

  // Anomalies regroupées par service, puis par personne
  const parService = useMemo(() => {
    const m = new Map<string, AnomalieRH[]>()
    for (const a of anomalies ?? []) m.set(a.personne_id, [...(m.get(a.personne_id) ?? []), a])
    const q = filtre.trim().toLowerCase()
    const pers = [...m].map(([id, liste]) => ({ personne: parId.get(id)!, liste: liste.sort((a, b) => b.jour.localeCompare(a.jour)) }))
      .filter((g) => g.personne && (!q || `${g.personne.prenom} ${g.personne.nom} ${g.personne.service}`.toLowerCase().includes(q)))
    const s = new Map<string, typeof pers>()
    for (const g of pers) s.set(g.personne.service, [...(s.get(g.personne.service) ?? []), g])
    return [...s].map(([nom, gens]) => ({ nom, gens: gens.sort((a, b) => b.liste.length - a.liste.length || a.personne.nom.localeCompare(b.personne.nom)),
      jours: gens.reduce((t, g) => t + g.liste.length, 0) })).sort((a, b) => b.jours - a.jours || a.nom.localeCompare(b.nom))
  }, [anomalies, parId, filtre])
  const nbPersonnes = parService.reduce((t, s) => t + s.gens.length, 0)
  const nbJours = parService.reduce((t, s) => t + s.jours, 0)
  // Une ligne par personne (pas une ligne par jour) : lisible même avec une centaine de personnes
  const gens = useMemo(() => parService.filter((s) => !service || s.nom === service).flatMap((s) => s.gens)
    .sort((a, b) => b.liste.length - a.liste.length || a.personne.nom.localeCompare(b.personne.nom)), [parService, service])
  const pager = usePagination(gens, 15, `${service}|${filtre}`)
  const [deplie, setDeplie] = useState<string | null>(null)

  async function rappeler(ids: string[]) {
    try {
      const n = await api.envoyerRappel(ids, 'Il te reste des pointages à régulariser avant la clôture du mois.')
      setMessage({ texte: n ? `Rappel envoyé à ${n} personne(s) ✅` : 'Déjà rappelé récemment (anti-spam)' })
    } catch (e) { erreur(e) }
  }

  return (
    <main className="contenu rh">
      <div className="tuiles col-pleine">
        <Tuile valeur={nbPersonnes} libelle="personnes en anomalie" alerte={nbPersonnes > 0} />
        <Tuile valeur={aConstater.length} libelle="congés à constater" />
        <Tuile valeur={heures.length} libelle="journées au-delà de 9 h" alerte={heures.length > 0} />
        <Tuile valeur={etat?.derniere_cloture ? nomMois(etat.derniere_cloture) : '—'} libelle="dernière clôture" texte />
      </div>

      <IndicateursMois api={api} />

      <div className="col-principale pile">
        {aConstater.length > 0 && (
          <Constat api={api} demandes={aConstater} onMessage={(texte, e) => (e ? setMessage({ texte, erreur: true }) : toutRecharger(texte))} onConstater={async (ids) => {
            try { const n = await api.constater(ids); await toutRecharger(`${n} congé(s) constaté(s)`) } catch (e) { erreur(e) }
          }} />
        )}

        {heures.length > 0 && (
          <section className="carte">
            <h2>Heures au-delà du maximum journalier</h2>
            <p className="doux petit">Politique du CFB : pas d’heures supplémentaires. Accorder = les heures passent en récup.</p>
            <ul className="liste">
              {heures.map((h) => (
                <li key={h.personne_id + h.jour}>
                  <span className="texte-ligne"><LienPersonne id={h.personne_id} nom={`${h.prenom} ${h.nom}`} vers="temps" /> · {dateCourte(h.jour)} · +{duree(h.minutes)}</span>
                  <button className="bouton secondaire petit" onClick={async () => {
                    try { await api.deciderHeures(h.personne_id, h.jour, false, 'Non autorisé'); await toutRecharger('Heures refusées') } catch (e) { erreur(e) }
                  }}>Refuser</button>
                  <button className="bouton petit" onClick={async () => {
                    try { await api.deciderHeures(h.personne_id, h.jour, true); await toutRecharger('Heures accordées en récup ✅') } catch (e) { erreur(e) }
                  }}>Accorder</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>Pointages à régulariser {nbPersonnes > 0 && <span className="doux petit">({nbPersonnes} pers. · {nbJours} j)</span>}</h2>
            <input id="filtre-anomalies" type="search" className="recherche" placeholder="Rechercher une personne…" aria-label="Rechercher une personne"
                   value={filtre} onChange={(e) => setFiltre(e.target.value)} />
          </div>
          {parService.length > 1 && (
            <div className="filtres" role="group" aria-label="Filtrer par service">
              <button className="puce" aria-pressed={service === null} onClick={() => setService(null)}>Tous <b>{nbPersonnes}</b></button>
              {parService.map((s) => (
                <button key={s.nom} className="puce" aria-pressed={service === s.nom} onClick={() => setService(service === s.nom ? null : s.nom)}>
                  {s.nom} <b>{s.gens.length}</b></button>
              ))}
            </div>
          )}
          {anomalies === null && <p className="vide">Chargement…</p>}
          {anomalies !== null && parService.length === 0 && <p className="vide">Aucune anomalie sur les 2 derniers mois</p>}
          {gens.length > 0 && (
            <>
              <div className="ligne entre petit outils-liste">
                <span className="doux">Trié par nombre de jours. Un appui sur « Jours » montre le détail.</span>
                <button className="bouton secondaire petit" onClick={() => rappeler(gens.map((g) => g.personne.id))}>
                  Rappeler {service ? `le service ${service}` : 'tout le monde'} ({gens.length})</button>
              </div>
              <ul className="liste-anomalies">
                {pager.items.map(({ personne, liste }) => {
                  const ouvert = deplie === personne.id
                  return (
                    <li key={personne.id} className={ouvert ? 'ouvert' : ''}>
                      <div className="ligne-anomalie">
                        <span className="qui"><LienPersonne id={personne.id} nom={`${personne.prenom} ${personne.nom}`} vers="temps" />
                          {personne.type === 'isp' && <span className="pilule neutre">ISP</span>}
                          <span className="doux petit">{personne.service}</span></span>
                        <span className="doux petit periode">{liste.length > 1 ? `${dateCourte(liste[liste.length - 1].jour)} → ${dateCourte(liste[0].jour)}` : dateCourte(liste[0].jour)}</span>
                        <button className="pilule attente bouton-pilule" aria-expanded={ouvert} onClick={() => setDeplie(ouvert ? null : personne.id)}
                                title="Voir les jours">{liste.length} j<IcChevron size={12} className={`chevron-mini ${ouvert ? 'ouvert' : ''}`} /></button>
                        <button className="lien petit" onClick={() => rappeler([personne.id])}>Rappeler</button>
                      </div>
                      {ouvert && (
                        <ul className="liste compacte jours-anomalies">
                          {liste.map((a) => (
                            <li key={a.jour + a.code}>
                              <span className="texte-ligne">{dateCourte(a.jour)} · <span className="doux">{
                                a.code === 'absent' ? 'aucun pointage' : a.code === 'semaine_max' ? 'maximum hebdomadaire dépassé (semaine)' : 'sortie manquante'}</span></span>
                              {a.code !== 'semaine_max' && (
                                <button className="lien petit" onClick={() => setAction({ type: 'pointage', personne, jour: a.jour, incomplet: a.code !== 'absent' })}>
                                  {a.code === 'absent' ? 'Ajouter les heures' : 'Ajouter la sortie'}</button>
                              )}
                              {a.code === 'absent' && (
                                <button className="lien petit" onClick={() => setAction({ type: 'absence', personne, jour: a.jour })}>Encoder une absence</button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
              <Pagination pager={pager} quoi="personnes" />
            </>
          )}
        </section>

      </div>

      <div className="col-laterale pile">
        <InfosACorriger api={api} onMessage={(texte, e) => setMessage({ texte, erreur: e })} />
        <Cloture mois={mois} setMois={setMois} etat={etat} onCloturer={async () => {
          try {
            const r = await api.cloturer(mois)
            await toutRecharger(`${nomMois(mois)} clôturé ✅` + (r.reports_boni ? ` · boni reporté pour ${r.reports_boni} personne(s)` : '')
              + (r.boni_hors_limites ? ` · ${r.boni_hors_limites} boni hors limites à vérifier` : ''))
          } catch (e) { erreur(e) }
        }} />

        <section className="carte">
          <h2>Encoder une absence</h2>
          <p className="doux petit">Maladie, accident de travail, petit chômage… L’absence est accordée directement.</p>
          <button className="bouton large" onClick={() => setAction({ type: 'absence' })}>Nouvelle absence</button>
        </section>

        <Manquants api={api} onMessage={(texte, e) => setMessage({ texte, erreur: e })} />

        <CongesAnnuels api={api} onFait={(n) => toutRecharger(`Congés attribués à ${n} personne(s) ✅`)} onErreur={erreur} />
      </div>

      {action?.type === 'pointage' && action.personne && action.jour && (
        <FenetrePointage personne={action.personne} jour={action.jour} incomplet={!!action.incomplet} onFermer={() => setAction(null)}
          onValider={async (corrections, motif) => {
            try {
              for (const [sens, min] of corrections) await api.corrigerPour(action.personne!.id, isoBxl(action.jour!, min), sens, motif)
              setAction(null); await toutRecharger('Pointage(s) ajouté(s) ✅')
            } catch (e) { erreur(e) }
          }} />
      )}
      {action?.type === 'absence' && (
        <FenetreAbsence personnes={personnes} codes={codes} personne={action.personne} jour={action.jour} onFermer={() => setAction(null)}
          onValider={async (personneId, s) => {
            try { await api.encoderAbsence(personneId, s); setAction(null); await toutRecharger('Absence encodée ✅') } catch (e) { erreur(e) }
          }} />
      )}
      <Toast message={message} />
    </main>
  )
}

// ---------------------------------------------------------------------------
const pct = (v: number | null) => (v === null || Number.isNaN(v) ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')} %`)
const ratio = (a: number, b: number) => (b > 0 ? (100 * a) / b : null)

/** Indicateurs RH du mois en cours (mêmes calculs que Rapports › Tableau de bord), avec le lien vers le détail. */
function IndicateursMois({ api }: { api: Api }) {
  const { naviguer } = useNav()
  const mois = `${jourBxl().slice(0, 8)}01`
  const [s, setS] = useState<StatsDirection | null>(null)
  useEffect(() => { api.statsDirection(mois).then(setS).catch(() => setS(null)) }, [api, mois])
  if (!s) return null
  const t = s.services.reduce((a, x) => ({ prevues: a.prevues + x.prevues, maladie: a.maladie + (x.absence_maladie ?? 0),
    abs: a.abs + x.absence_conge + (x.absence_maladie ?? 0) + x.absence_autre, tt: a.tt + x.jours_tt, presence: a.presence + x.jours_presence,
    effectif: a.effectif + x.effectif }), { prevues: 0, maladie: 0, abs: 0, tt: 0, presence: 0, effectif: 0 })
  const plusAbsent = [...s.services].filter((x) => x.prevues > 0)
    .sort((a, b) => (ratio(b.absence_conge + (b.absence_maladie ?? 0) + b.absence_autre, b.prevues) ?? 0) - (ratio(a.absence_conge + (a.absence_maladie ?? 0) + a.absence_autre, a.prevues) ?? 0))[0]
  return (
    <section className="carte col-pleine indicateurs-rh">
      <div className="ligne entre"><h2>Ce mois-ci <span className="doux petit">· {nomMois(mois)} · {t.effectif} personnes</span></h2>
        <button className="lien petit" onClick={() => naviguer({ vers: 'onglet', onglet: 'rapports' })}>Tous les indicateurs</button></div>
      <dl className="mini-stats">
        <div><dt>Taux d’absence</dt><dd>{pct(ratio(t.abs, t.prevues))}</dd></div>
        <div><dt>dont maladie</dt><dd>{pct(ratio(t.maladie, t.prevues))}</dd></div>
        <div><dt>Télétravail</dt><dd>{pct(ratio(t.tt, t.presence))}</dd></div>
        <div><dt>Demandes en attente</dt><dd>{s.demandes.en_attente}</dd></div>
        {plusAbsent && <div><dt>Service le plus absent</dt><dd className="texte">{plusAbsent.service}</dd></div>}
      </dl>
    </section>
  )
}

function Tuile({ valeur, libelle, alerte, texte }: { valeur: number | string; libelle: string; alerte?: boolean; texte?: boolean }) {
  return (
    <div className={`tuile ${alerte ? 'alerte' : ''}`}>
      <strong className={texte ? 'texte' : ''}>{valeur}</strong><span>{libelle}</span>
    </div>
  )
}

function Cloture({ mois, setMois, etat, onCloturer }: {
  mois: string; setMois: (m: string) => void; etat: EtatCloture | null; onCloturer: () => Promise<void>
}) {
  const [confirmer, setConfirmer] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const options = useMemo(() => {
    const r: string[] = []
    const d = new Date(`${jourBxl().slice(0, 8)}01T12:00:00Z`)
    for (let i = 0; i < 6; i++) { d.setUTCMonth(d.getUTCMonth() - 1); r.push(d.toISOString().slice(0, 10)) }
    return r
  }, [])
  useEffect(() => setConfirmer(false), [mois])

  const nbAnomalies = etat?.anomalies.reduce((t, a) => t + a.jours, 0) ?? 0
  const bloque = !etat || etat.deja_cloture || !etat.mois_termine || etat.demandes_en_attente > 0
  const points: [boolean, string][] = etat ? [
    [etat.mois_termine, etat.mois_termine ? 'Mois terminé' : 'Mois en cours'],
    [etat.demandes_en_attente === 0, etat.demandes_en_attente === 0 ? 'Aucune demande en attente'
      : `${etat.demandes_en_attente} demande(s) encore en attente de décision (bloquant)`],
    [nbAnomalies === 0, nbAnomalies === 0 ? 'Aucune anomalie' : `${nbAnomalies} jour(s) en anomalie chez ${etat.anomalies.length} personne(s)`],
    [etat.conges_a_constater === 0, etat.conges_a_constater === 0 ? 'Tous les congés sont constatés' : `${etat.conges_a_constater} congé(s) à constater`],
  ] : []

  return (
    <section className="carte cloture">
      <h2>Clôture du mois</h2>
      <label className="champ">Mois
        <select id="mois-cloture" value={mois} onChange={(e) => setMois(e.target.value)}>
          {options.map((m) => <option key={m} value={m}>{nomMois(m)}</option>)}
        </select>
      </label>
      {!etat && <p className="vide">Chargement…</p>}
      {etat?.deja_cloture && <p className="pilule ok" style={{ display: 'inline-block' }}>Déjà clôturé</p>}
      {etat && !etat.deja_cloture && (
        <>
          <ul className="controle">
            {points.map(([ok, texte]) => <li key={texte} className={ok ? 'ok' : 'ko'}><span>{ok ? <IcCheck size={14} /> : <IcAttention size={14} />}</span>{texte}</li>)}
          </ul>
          {!confirmer
            ? <button className="bouton large" disabled={bloque} onClick={() => (nbAnomalies > 0 ? setConfirmer(true) : (setEnCours(true), onCloturer().finally(() => setEnCours(false))))}>
                Clôturer {nomMois(mois)}</button>
            : <div className="confirmation">
                <p className="petit"><strong>{nbAnomalies} jour(s) en anomalie</strong> resteront tels quels : après clôture, plus aucune correction possible sur ce mois.</p>
                <div className="actions">
                  <button className="bouton secondaire" onClick={() => setConfirmer(false)}>Retour</button>
                  <button className="bouton danger" disabled={enCours} onClick={() => { setEnCours(true); onCloturer().finally(() => { setEnCours(false); setConfirmer(false) }) }}>
                    Clôturer quand même</button>
                </div>
              </div>}
          <p className="doux petit" style={{ marginBottom: 0 }}>Export Partena : format à confirmer avec le secrétariat social.</p>
        </>
      )}
    </section>
  )
}

function Constat({ api, demandes, onConstater, onMessage }: {
  api: Api; demandes: Demande[]; onConstater: (ids: string[]) => Promise<void>; onMessage: (t: string, erreur?: boolean) => void
}) {
  const [enCours, setEnCours] = useState(false)
  return (
    <section className="carte">
      <div className="ligne entre"><h2>Congés accordés à constater</h2>
        <button className="bouton petit" disabled={enCours} onClick={async () => { setEnCours(true); await onConstater(demandes.map((d) => d.id)); setEnCours(false) }}>
          Tout constater ({demandes.length})</button></div>
      <ul className="liste compacte">
        {demandes.map((d) => (
          <li key={d.id}>
            <span className="texte-ligne"><LienPersonne id={d.personne_id} nom={`${d.prenom} ${d.nom}`} /> · {d.libelle_absence}
              <span className="doux"> · {d.date_debut === d.date_fin ? dateCourte(d.date_debut) : `${dateCourte(d.date_debut)} → ${dateCourte(d.date_fin)}`}
              {d.demi ? (d.demi === 'matin' ? ' matin' : ' après-midi') : ''}</span></span>
            <span className="doux petit">{duree(d.minutes_decomptees)}</span>
            <Justificatif api={api} d={d} peutDeposer onChange={onMessage} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function CongesAnnuels({ api, onFait, onErreur }: { api: Api; onFait: (n: number) => Promise<void>; onErreur: (e: unknown) => void }) {
  const annee = Number(jourBxl().slice(0, 4)) + 1
  const [liste, setListe] = useState<PropositionConges[] | null>(null)
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)
  useEffect(() => { if (ouvert && !liste) api.propositionConges(annee).then(setListe).catch(onErreur) }, [ouvert, liste, api, annee, onErreur])

  return (
    <section className="carte">
      <h2>Congés annuels {annee}</h2>
      <p className="doux petit">Calcul automatique : 4 semaines du régime, au prorata des mois de présence en {annee - 1}. Règle provisoire, à valider.</p>
      {!ouvert ? <button className="bouton secondaire large" onClick={() => setOuvert(true)}>Voir la proposition</button> : (
        <>
          {!liste && <p className="vide">Calcul…</p>}
          {liste && (
            <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
              <table className="tableau">
                <thead><tr><th>Personne</th><th>Régime</th><th className="num">Mois</th><th className="num">Heures</th><th className="num">≈ Jours</th></tr></thead>
                <tbody>{liste.map((p) => (
                  <tr key={p.personne_id}><td><LienPersonne id={p.personne_id} nom={`${p.prenom} ${p.nom}`} /></td><td className="doux">{p.regime}</td><td className="num">{p.mois_presence}</td>
                    <td className="num">{duree(p.minutes)}</td><td className="num">{String(Math.round((p.minutes / JOUR_RH) * 10) / 10).replace('.', ',')}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {liste && <button className="bouton large" disabled={enCours} onClick={async () => {
            setEnCours(true)
            try { await onFait(await api.attribuerConges(annee)) } catch (e) { onErreur(e) } finally { setEnCours(false) }
          }}>Attribuer à {liste.length} personne(s)</button>}
          <p className="doux petit" style={{ marginBottom: 0 }}>Sans risque de doublon : une personne déjà servie pour {annee} est ignorée.</p>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

const enMinutes = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }

function FenetrePointage({ personne, jour, incomplet, onFermer, onValider }: {
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

function FenetreAbsence({ personnes, codes, personne, jour, onFermer, onValider }: {
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


// Absences accordées dont le justificatif requis manque (3 derniers mois) : joindre ou relancer la personne
function Manquants({ api, onMessage }: { api: Api; onMessage: (t: string, erreur?: boolean) => void }) {
  const [liste, setListe] = useState<Demande[] | null>(null)
  const charger = useCallback(() => { api.justificatifsManquants().then(setListe).catch(() => setListe([])) }, [api])
  useEffect(() => { charger() }, [charger])
  if (!liste?.length) return null
  return (
    <section className="carte">
      <div className="ligne entre"><h2>Justificatifs manquants</h2><span className="pilule attente">{liste.length}</span></div>
      <ul className="liste compacte">{liste.map((d) => (
        <li key={d.id}>
          <span className="texte-ligne"><LienPersonne id={d.personne_id} nom={`${d.prenom} ${d.nom}`} /> · {d.libelle_absence}
            <span className="doux"> · {d.date_debut === d.date_fin ? dateCourte(d.date_debut) : `${dateCourte(d.date_debut)} → ${dateCourte(d.date_fin)}`}</span></span>
          <Justificatif api={api} d={d} peutDeposer onChange={(t, e) => { onMessage(t, e); if (!e) charger() }} />
          <button className="lien petit" onClick={async () => {
            try {
              const n = await api.envoyerRappel([d.personne_id], `Merci de joindre ton justificatif (${d.libelle_absence}) dans l’appli, onglet Congés.`)
              onMessage(n ? 'Rappel envoyé ✅' : 'Déjà rappelé récemment')
            } catch (e) { onMessage(messageErreur(e), true) }
          }}>Rappeler</button>
        </li>
      ))}</ul>
    </section>
  )
}

/** Signalements « une info est fausse » envoyés depuis Mon compte : ouvrir la fiche, corriger, puis « Corrigé ». */
function InfosACorriger({ api, onMessage }: { api: Api; onMessage: (t: string, erreur?: boolean) => void }) {
  const [liste, setListe] = useState<Signalement[] | null>(null)
  const charger = useCallback(() => { api.signalementsOuverts().then(setListe).catch(() => setListe([])) }, [api])
  useEffect(() => { charger() }, [charger])
  if (!liste?.length) return null
  return (
    <section className="carte infos-a-corriger">
      <div className="ligne entre"><h2>Infos à corriger</h2><span className="pilule attente">{liste.length}</span></div>
      <p className="doux petit" style={{ marginTop: 4 }}>Signalées par les personnes depuis Mon compte. Ouvre la fiche, corrige, puis « Corrigé » : la personne est prévenue.</p>
      <ul className="liste">{liste.map((x) => (
        <li key={x.id}>
          <span className="texte-ligne"><LienPersonne id={x.personne_id!} nom={`${x.prenom} ${x.nom}`} /> · <strong>{libelleChamp(x.champ)}</strong>
            {x.message && <div className="doux petit">« {x.message} »</div>}
            <div className="doux petit">{x.service} · {dateCourte(jourBxl(new Date(x.cree_le)))}</div></span>
          <button className="bouton secondaire petit" onClick={async () => {
            try { await api.traiterSignalement(x.id); onMessage('Marqué comme corrigé ✅ (la personne est prévenue)'); charger() } catch (e) { onMessage(messageErreur(e), true) }
          }}>Corrigé</button>
        </li>
      ))}</ul>
    </section>
  )
}
