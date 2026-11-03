import { LienPersonne, LienReglages } from '../lib/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { Api, LigneCpas, LigneTeletravail, Profil, StatService, StatsDirection } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { telecharger, type Format } from '../lib/export'
import Export from '../components/Export'
import { duree, jourBxl } from '../lib/temps'

const MOIS_LONG = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MOIS_COURT = new Intl.DateTimeFormat('fr-BE', { month: 'short', timeZone: 'UTC' })
const nomMois = (iso: string) => MOIS_LONG.format(new Date(`${iso}T12:00:00Z`))
const pct = (v: number | null) => (v === null || Number.isNaN(v) ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')} %`)
const ratio = (a: number, b: number) => (b > 0 ? (100 * a) / b : null)

function moisDisponibles(): string[] {
  const r: string[] = []
  const d = new Date(`${jourBxl().slice(0, 8)}01T12:00:00Z`)
  for (let i = 0; i < 12; i++) { r.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() - 1) }
  return r
}

export default function Rapports({ api, profil }: { api: Api; profil: Profil }) {
  const voitStats = ['direction', 'admin', 'rh', 'admin_rh'].includes(profil.role)
  const voitCpas = ['direction', 'admin', 'rh', 'admin_rh', 'responsable_isp'].includes(profil.role)
  const [vue, setVue] = useState<'stats' | 'tt' | 'cpas'>(voitStats ? 'stats' : 'cpas')
  const mois = useMemo(moisDisponibles, [])
  const [choix, setChoix] = useState(mois[1])   // mois précédent (complet)

  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <div className="ligne entre barre-outils">
          {voitStats ? (
            <div className="segments compact" role="radiogroup" aria-label="Rapport">
              <button type="button" role="radio" aria-checked={vue === 'stats'} onClick={() => setVue('stats')}>Tableau de bord</button>
              <button type="button" role="radio" aria-checked={vue === 'tt'} onClick={() => setVue('tt')}>Télétravail</button>
              {voitCpas && <button type="button" role="radio" aria-checked={vue === 'cpas'} onClick={() => setVue('cpas')}>Rapport CPAS</button>}
            </div>
          ) : <h2>Rapport CPAS</h2>}
          <select id="mois-rapport" className="choix-mois" value={choix} onChange={(e) => setChoix(e.target.value)} aria-label="Mois">
            {mois.map((m, i) => <option key={m} value={m}>{nomMois(m)}{i === 0 ? ' (en cours)' : ''}</option>)}
          </select>
        </div>
        {vue === 'stats' && voitStats && <TableauDeBord api={api} mois={choix} />}
        {vue === 'tt' && voitStats && <RapportTeletravail api={api} mois={choix} />}
        {vue === 'cpas' && voitCpas && <RapportCpas api={api} mois={choix} />}
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
function TableauDeBord({ api, mois }: { api: Api; mois: string }) {
  const [s, setS] = useState<StatsDirection | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  useEffect(() => { setS(null); setErreur(null); api.statsDirection(mois).then(setS).catch((e) => setErreur(messageErreur(e))) }, [api, mois])

  if (erreur) return <section className="carte"><p className="negatif">{erreur}</p></section>
  if (!s) return <section className="carte"><p className="vide">Calcul des indicateurs…</p></section>

  const mal = (x: StatService) => x.absence_maladie ?? 0
  const tot = s.services.reduce((t, x) => ({
    prevues: t.prevues + x.prevues, preste: t.preste + x.preste, conge: t.conge + x.absence_conge, maladie: t.maladie + mal(x),
    autre: t.autre + x.absence_autre, presence: t.presence + x.jours_presence, tt: t.tt + x.jours_tt, anomalies: t.anomalies + x.anomalies,
    effectif: t.effectif + x.effectif,
  }), { prevues: 0, preste: 0, conge: 0, maladie: 0, autre: 0, presence: 0, tt: 0, anomalies: 0, effectif: 0 })
  const absTotal = tot.conge + tot.maladie + tot.autre
  const absDe = (x: StatService) => x.absence_conge + mal(x) + x.absence_autre
  const tauxAbs = (x: StatService) => ratio(absDe(x), x.prevues)
  const maxAbs = Math.max(10, ...s.services.map((x) => tauxAbs(x) ?? 0))
  const masques = s.services.some((x) => x.absence_maladie === null)
  const parAnomalies = [...s.services].filter((x) => x.anomalies > 0).sort((a, b) => b.anomalies - a.anomalies)
  const d = s.demandes, decidees = d.accordees + d.refusees

  function exporterCsv(format: Format) {
    const h = (m: number) => (m / 60).toFixed(2).replace('.', ',')
    const p1 = (v: number | null) => (v === null ? '' : (Math.round(v * 10) / 10).toString().replace('.', ','))
    const entete = ['Service', 'Effectif', 'Heures prévues', 'Heures prestées', 'Congés (h)', 'Maladie (h)', 'Autres absences (h)',
                    'Taux d’absence (%)', 'Jours prestés', 'Jours télétravail', 'Anomalies (jours)']
    const corps = s!.services.map((x) => [x.service, x.effectif, h(x.prevues), h(x.preste), h(x.absence_conge),
      x.absence_maladie === null ? 'masqué' : h(x.absence_maladie), h(x.absence_autre), p1(tauxAbs(x)), x.jours_presence, x.jours_tt, x.anomalies])
    telecharger([entete, ...corps], `indicateurs-${mois.slice(0, 7)}`, format)
  }

  return (
    <>
      <div className="tuiles">
        <div className="tuile"><strong>{pct(ratio(absTotal, tot.prevues))}</strong><span>taux d’absence</span>
          <small className="doux">dont maladie {pct(ratio(tot.maladie, tot.prevues))}{masques ? ' (hors petits services)' : ''}</small></div>
        <div className="tuile"><strong>{pct(ratio(tot.tt, tot.presence))}</strong><span>des jours prestés en télétravail</span>
          <small className="doux">{tot.tt} jour(s) sur {tot.presence}</small></div>
        <div className="tuile"><strong>{pct(ratio(tot.preste, tot.prevues - absTotal))}</strong><span>heures prestées / à prester</span>
          <small className="doux">{duree(tot.preste)} sur {duree(tot.prevues - absTotal)}</small></div>
        <div className={`tuile ${tot.anomalies > 0 ? 'alerte' : ''}`}><strong>{tot.anomalies}</strong><span>jour(s) de pointage à régulariser</span>
          <small className="doux">{parAnomalies.length} service(s) concerné(s)</small></div>
        <div className={`tuile ${d.en_attente > 0 ? 'alerte' : ''}`}><strong>{d.en_attente}</strong><span>demandes en attente</span>
          <small className="doux">délai moyen de décision : {d.delai_moyen_heures === null ? '—' : `${String(d.delai_moyen_heures).replace('.', ',')} h`}</small></div>
        <div className="tuile"><strong>{pct(ratio(d.accordees, decidees))}</strong><span>des demandes accordées</span>
          <small className="doux">{d.accordees} accordée(s) · {d.refusees} refusée(s)</small></div>
      </div>

      <section className="carte">
        <div className="ligne entre barre-outils">
          <h2>Par service <span className="doux petit">· {nomMois(s.debut)} · {tot.effectif} personnes</span></h2>
          <Export onExporter={exporterCsv} />
        </div>
        <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
          <table className="tableau services">
            <thead><tr>
              <th>Service</th><th className="num">Effectif</th><th>Taux d’absence</th><th className="num">Congés</th><th className="num">Maladie</th>
              <th className="num">Autres</th><th className="num">Télétravail</th><th className="num">Prestées / à prester</th><th className="num">Anomalies</th>
            </tr></thead>
            <tbody>{s.services.map((x) => {
              const t = tauxAbs(x) ?? 0
              return (
                <tr key={x.service} className={x.regroupe ? 'regroupe' : ''}>
                  <td><strong>{x.service}</strong></td>
                  <td className="num">{x.effectif}</td>
                  <td><span className="barre-cellule"><span className="barre-trace"><span style={{ width: `${(t / maxAbs) * 100}%` }} /></span>
                    <span className="num">{pct(t)}</span></span></td>
                  <td className="num">{pct(ratio(x.absence_conge, x.prevues))}</td>
                  <td className="num">{x.absence_maladie === null ? <span className="doux" title="Groupe trop petit : la maladie est comptée dans « Autres »">masqué</span> : pct(ratio(x.absence_maladie, x.prevues))}</td>
                  <td className="num">{pct(ratio(x.absence_autre, x.prevues))}</td>
                  <td className="num">{pct(ratio(x.jours_tt, x.jours_presence))}</td>
                  <td className="num">{pct(ratio(x.preste, x.prevues - absDe(x)))}</td>
                  <td className="num">{x.anomalies > 0 ? <span className="pilule attente">{x.anomalies} j</span> : '0'}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
        <p className="doux petit" style={{ marginBottom: 0 }}>
          Chiffres agrégés par service : aucune donnée individuelle.
          {s.seuil_anonymat && s.seuil_anonymat > 1 ? ` Les services de moins de ${s.seuil_anonymat} personnes sont regroupés (réglable dans Admin → Paramètres).` : ''}
        </p>
      </section>

      <div className="graphes">
        <Barres titre="Taux d’absence" sousTitre="6 derniers mois · congés, maladie et autres absences accordées" donnees={s.tendance.map((t) => [t.mois, t.taux_absence])} />
        <Barres titre="Télétravail" sousTitre="6 derniers mois · part des jours prestés" donnees={s.tendance.map((t) => [t.mois, t.taux_tt])} />
      </div>

      <div className="graphes">
        <section className="carte">
          <h2>Répartition des absences</h2>
          <p className="doux petit" style={{ margin: '-6px 0 10px' }}>Part des heures d’absence du mois, tous services</p>
          {([['Congés', tot.conge], ['Maladie', tot.maladie], ['Autres absences', tot.autre]] as [string, number][]).map(([l, v]) => (
            <div key={l} className="repartition">
              <div className="ligne entre petit"><span>{l}</span><span className="num">{pct(ratio(v, absTotal))} · {duree(v)}</span></div>
              <div className="barre fine"><span style={{ width: `${ratio(v, absTotal) ?? 0}%` }} /></div>
            </div>
          ))}
        </section>
        <section className="carte">
          <h2>Pointages à régulariser</h2>
          <p className="doux petit" style={{ margin: '-6px 0 10px' }}>Jours sans pointage complet, par service. Les rappels se font depuis l’onglet RH.</p>
          {parAnomalies.length === 0 && <p className="vide">Aucun jour à régulariser.</p>}
          {parAnomalies.map((x) => (
            <div key={x.service} className="repartition">
              <div className="ligne entre petit"><span>{x.service}</span><span className="num">{x.anomalies} j</span></div>
              <div className="barre fine"><span style={{ width: `${(x.anomalies / parAnomalies[0].anomalies) * 100}%` }} /></div>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}


// Petit graphique en barres, une seule série (pas de légende : le titre la nomme)
function Barres({ titre, sousTitre, donnees }: { titre: string; sousTitre: string; donnees: [string, number | null][] }) {
  const [survol, setSurvol] = useState<number | null>(null)
  const L = 320, H = 150, G = 40, B = 22, haut = 12
  const max = Math.max(5, ...donnees.map(([, v]) => v ?? 0))
  const pas = max > 20 ? 10 : 5
  const plafond = Math.ceil(max / pas) * pas
  const y = (v: number) => haut + (H - haut - B) * (1 - v / plafond)
  const largeurBarre = Math.min(30, ((L - G) / donnees.length) * 0.55)
  const x = (i: number) => G + ((L - G) / donnees.length) * (i + 0.5)
  const graduations = [0, plafond / 2, plafond]
  const dernier = donnees.length - 1

  return (
    <section className="carte graphe">
      <h2>{titre}</h2>
      <p className="doux petit" style={{ margin: '-6px 0 8px' }}>{sousTitre}</p>
      <div className="graphe-zone">
        <svg viewBox={`0 0 ${L} ${H}`} role="img" aria-label={`${titre} : ${donnees.map(([m, v]) => `${MOIS_COURT.format(new Date(`${m}T12:00:00Z`))} ${pct(v)}`).join(', ')}`}>
          {graduations.map((g) => (
            <g key={g}>
              <line x1={G} x2={L} y1={y(g)} y2={y(g)} className="grille" />
              <text x={G - 6} y={y(g) + 4} className="axe" textAnchor="end">{pct(g)}</text>
            </g>
          ))}
          {donnees.map(([m, v], i) => {
            const h = v === null ? 0 : Math.max(0, y(0) - y(v))
            const x0 = x(i) - largeurBarre / 2, r = Math.min(4, h)
            return (
              <g key={m} onMouseEnter={() => setSurvol(i)} onMouseLeave={() => setSurvol(null)} onClick={() => setSurvol(i)}>
                <rect x={x(i) - ((L - G) / donnees.length) / 2} y={haut} width={(L - G) / donnees.length} height={H - haut - B} fill="transparent" />
                {h > 0 && <path className={`barre-mark ${survol !== null && survol !== i ? 'estompee' : ''}`}
                  d={`M${x0},${y(0)} V${y(0) - h + r} Q${x0},${y(0) - h} ${x0 + r},${y(0) - h} H${x0 + largeurBarre - r} Q${x0 + largeurBarre},${y(0) - h} ${x0 + largeurBarre},${y(0) - h + r} V${y(0)} Z`} />}
                <text x={x(i)} y={H - 6} className="axe" textAnchor="middle">{MOIS_COURT.format(new Date(`${m}T12:00:00Z`)).replace('.', '')}</text>
                {(i === dernier && survol === null) && v !== null && <text x={x(i)} y={y(v) - 6} className="valeur" textAnchor="middle">{pct(v)}</text>}
              </g>
            )
          })}
          <line x1={G} x2={L} y1={y(0)} y2={y(0)} className="base" />
        </svg>
        {survol !== null && (
          <div className="infobulle" style={{ left: `${(x(survol) / L) * 100}%` }}>
            <strong>{pct(donnees[survol][1])}</strong><span>{nomMois(donnees[survol][0])}</span>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
function RapportCpas({ api, mois }: { api: Api; mois: string }) {
  const [lignes, setLignes] = useState<LigneCpas[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  useEffect(() => { setLignes(null); setErreur(null); api.rapportCpas(mois).then(setLignes).catch((e) => setErreur(messageErreur(e))) }, [api, mois])

  function exporterCsv(format: Format) {
    if (!lignes) return
    const h = (m: number) => (m / 60).toFixed(2).replace('.', ',')
    const entete = ['Nom', 'Prénom', 'Partenaire', 'Service', 'Régime', 'Heures à prester', 'Heures prestées', 'Écart (h)',
                    'Congés (h)', 'Autres absences justifiées (h)', 'Maladie (h)', 'Jours non justifiés', 'Jours incomplets']
    const corps = lignes.map((l) => [l.nom, l.prenom, l.partenaire, l.service, l.regime ?? '', h(l.a_prester), h(l.preste), h(l.ecart),
                                     h(l.conges), h(l.absence_justifiee), h(l.absence_maladie), l.jours_non_justifies, l.jours_incomplets])
    telecharger([entete, ...corps], `rapport-cpas-${mois.slice(0, 7)}`, format)
  }

  if (erreur) return <section className="carte"><p className="negatif">{erreur}</p></section>
  return (
    <section className="carte">
      <div className="ligne entre">
        <div><h2>Heures des ISP — {nomMois(mois)}</h2>
          <p className="doux petit" style={{ margin: '4px 0 0' }}>Pour le suivi des contrats article 60 : heures et congés à communiquer au CPAS.</p></div>
        <span className="ligne">
          <button className="bouton secondaire petit" onClick={() => window.print()}>Imprimer</button>
          <Export disabled={!lignes?.length} onExporter={exporterCsv} />
        </span>
      </div>
      {!lignes && <p className="vide">Calcul…</p>}
      {lignes?.length === 0 && <p className="vide">Aucune personne ISP sur ce mois.</p>}
      {lignes && lignes.length > 0 && (
        <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
          <table className="tableau">
            <thead><tr>
              <th>ISP</th><th>Service</th><th className="num">À prester</th><th className="num">Prestées</th><th className="num">Écart</th>
              <th className="num">Congés</th><th className="num">Autres justifiées</th><th className="num">Maladie</th><th className="num">Jours non justifiés</th><th className="num">Jours incomplets</th>
            </tr></thead>
            <tbody>{lignes.map((l) => (
              <tr key={l.personne_id}>
                <td><LienPersonne id={l.personne_id} nom={`${l.nom} ${l.prenom}`} vers="temps" /><div className="doux petit">{l.partenaire}</div></td>
                <td>{l.service}</td>
                <td className="num">{duree(l.a_prester)}</td>
                <td className="num">{duree(l.preste)}</td>
                <td className={`num ${l.ecart < 0 ? 'negatif' : 'positif'}`}>{duree(l.ecart, true)}</td>
                <td className="num">{duree(l.conges)}</td>
                <td className="num">{duree(l.absence_justifiee)}</td>
                <td className="num">{duree(l.absence_maladie)}</td>
                <td className="num">{l.jours_non_justifies > 0 ? <span className="pilule ko">{l.jours_non_justifies}</span> : '0'}</td>
                <td className="num">{l.jours_incomplets > 0 ? <span className="pilule attente">{l.jours_incomplets}</span> : '0'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="doux petit" style={{ marginBottom: 0 }}>À prester = heures du régime moins les absences accordées. Jours non justifiés = aucun pointage et aucune absence encodée.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
const JOURS_SEM = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']
/** Jours de télétravail par personne (indemnité de fin de mois) : 1 jour dès qu'il y a un pointage « Télétravail ». */
function RapportTeletravail({ api, mois }: { api: Api; mois: string }) {
  const [lignes, setLignes] = useState<LigneTeletravail[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')
  useEffect(() => { setLignes(null); setErreur(null); api.rapportTeletravail(mois).then(setLignes).catch((e) => setErreur(messageErreur(e))) }, [api, mois])

  const sansAccent = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const visibles = (lignes ?? []).filter((l) => !filtre || sansAccent(`${l.nom} ${l.prenom} ${l.service}`).includes(sansAccent(filtre)))
  const total = visibles.reduce((t, l) => t + l.jours_tt, 0)
  const avecIndemnite = (lignes ?? []).some((l) => (l.indemnite_centimes ?? 0) > 0)
  const totalIndemnite = visibles.reduce((t, l) => t + (l.indemnite_centimes ?? 0), 0)
  const eur = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`
  const enCours = mois.slice(0, 7) === jourBxl().slice(0, 7)

  function exporterCsv(format: Format) {
    if (!lignes) return
    const entete = ['Nom', 'Prénom', 'Service', 'Jours de télétravail', 'Indemnité (€ HT)', 'Dates', 'Jours habituels']
    const corps = lignes.map((l) => [l.nom, l.prenom, l.service, l.jours_tt, ((l.indemnite_centimes ?? 0) / 100).toFixed(2).replace('.', ','), l.dates.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`).join(' '),
                                     l.jours_habituels.map((j) => JOURS_SEM[j - 1]).join(' ')])
    telecharger([entete, ...corps], `teletravail-${mois.slice(0, 7)}`, format)
  }

  if (erreur) return <section className="carte"><p className="negatif">{erreur}</p></section>
  return (
    <section className="carte">
      <div className="ligne entre">
        <div><h2>Jours de télétravail — {nomMois(mois)}</h2>
          <p className="doux petit" style={{ margin: '4px 0 0' }}>Pour l’indemnité de télétravail : un jour compte dès qu’il y a au moins un pointage « Télétravail ».
            {enCours && ' Mois en cours : chiffres provisoires.'}</p></div>
        <span className="ligne">
          <button className="bouton secondaire petit" onClick={() => window.print()}>Imprimer</button>
          <Export disabled={!lignes?.length} onExporter={exporterCsv} />
        </span>
      </div>
      {lignes && lignes.length > 8 && (
        <input type="search" id="filtre-tt" className="recherche" style={{ marginTop: 12 }} placeholder="Filtrer par nom ou service…" aria-label="Filtrer" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
      )}
      {!lignes && <p className="vide">Calcul…</p>}
      {lignes?.length === 0 && <p className="vide">Aucun télétravail sur ce mois.</p>}
      {lignes && lignes.length > 0 && (
        <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
          <table className="tableau">
            <thead><tr><th>Personne</th><th>Service</th><th className="num">Jours TT</th>{avecIndemnite && <th className="num">Indemnité</th>}<th>Dates</th><th>Jours habituels</th></tr></thead>
            <tbody>{visibles.map((l) => (
              <tr key={l.personne_id}>
                <td><LienPersonne id={l.personne_id} nom={`${l.nom} ${l.prenom}`} vers="temps" /></td>
                <td>{l.service}</td>
                <td className="num"><strong>{l.jours_tt}</strong></td>
                {avecIndemnite && <td className="num">{l.indemnite_centimes ? eur(l.indemnite_centimes) : '—'}</td>}
                <td className="petit">{l.dates.length ? l.dates.map((d) => Number(d.slice(8))).join(', ') : <span className="doux">—</span>}</td>
                <td className="petit">{l.jours_habituels.length ? l.jours_habituels.map((j) => JOURS_SEM[j - 1]).join(', ') : <span className="doux">aucun</span>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}><strong>Total</strong> ({visibles.length} personne{visibles.length > 1 ? 's' : ''})</td><td className="num"><strong>{total}</strong></td>{avecIndemnite && <td className="num"><strong>{eur(totalIndemnite)}</strong></td>}<td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      )}
      <p className="doux petit" style={{ marginBottom: 0 }}>Indemnité calculée selon <LienReglages section="parametres">Réglages › Télétravail</LienReglages> (montant, par jour ou forfait, plafond) ; HT.</p>
    </section>
  )
}
