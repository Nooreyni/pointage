import { useEffect, useMemo, useState } from 'react'
import type { Api, Demande, Ferie, Pointage, Profil } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateLongue, decalerJour, duree, heure, jourBxl } from '../lib/temps'

const MOIS = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MOIS_COURT = new Intl.DateTimeFormat('fr-BE', { month: 'short', timeZone: 'UTC' })
const JOUR_SEM = new Intl.DateTimeFormat('fr-BE', { weekday: 'short', timeZone: 'UTC' })
const ENTETES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const d12 = (j: string) => new Date(`${j}T12:00:00Z`)
const isodow = (j: string) => ((d12(j).getUTCDay() + 6) % 7) + 1
const premierDuMois = (j: string) => `${j.slice(0, 8)}01`
const finDuMois = (m: string) => { const d = d12(m); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) }
const decalerMois = (m: string, n: number) => { const d = d12(m); d.setUTCMonth(d.getUTCMonth() + n, 1); return d.toISOString().slice(0, 10) }
const nbJours = (a: string, b: string) => Math.round((d12(b).getTime() - d12(a).getTime()) / 86_400_000)

type Evenement =
  | { genre: 'ferie'; libelle: string }
  | { genre: 'conge'; d: Demande }
  | { genre: 'tt_fait' }
  | { genre: 'tt_prevu' }

interface Jour { jour: string; dansMois: boolean; repos: boolean; evts: Evenement[]; pts: Pointage[] }

function libelleConge(d: Demande): string {
  if (d.type === 'conge_demi_jour') return `${d.libelle_absence} (${d.demi === 'matin' ? 'matin' : 'après-midi'})`
  if (d.type === 'conge_heures') return `${d.libelle_absence} (${duree(d.minutes_decomptees)})`
  return d.libelle_absence
}
const texteEvt = (e: Evenement): string =>
  e.genre === 'ferie' ? `Férié : ${e.libelle}`
  : e.genre === 'conge' ? `${libelleConge(e.d)}, ${e.d.statut === 'accordee' ? 'accordé' : 'en attente de réponse'}`
  : e.genre === 'tt_fait' ? 'Télétravail (pointé)' : 'Télétravail prévu'

/** Agenda personnel : vue du mois (par défaut) ou liste de ce qui arrive — télétravail, congés, jours fériés. */
export default function Agenda({ api, profil, onDemanderConge, onVoirCompte }: {
  api: Api; profil: Profil; onDemanderConge: () => void; onVoirCompte: () => void
}) {
  const auj = jourBxl()
  const [vue, setVue] = useState<'mois' | 'liste'>('mois')
  const [mois, setMois] = useState(premierDuMois(auj))
  const [choisi, setChoisi] = useState(auj)
  const [demandes, setDemandes] = useState<Demande[] | null>(null)
  const [feries, setFeries] = useState<Ferie[]>([])
  const [ttHabituel, setTtHabituel] = useState<number[]>(profil.jours_teletravail ?? [])
  const [pts, setPts] = useState<Pointage[]>([])
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    api.mesDemandes().then(setDemandes).catch((e) => setErreur(messageErreur(e)))
    api.feries().then(setFeries).catch(() => {})
    api.teletravailDe(profil.id).then((t) => setTtHabituel(t.jours)).catch(() => {})
  }, [api, profil.id])

  useEffect(() => {
    let actif = true
    const fin = finDuMois(mois)
    if (mois > auj) { setPts([]); return }
    api.pointages(mois, fin < auj ? fin : auj).then((p) => { if (actif) setPts(p.filter((x) => !x.annule)) }).catch(() => {})
    return () => { actif = false }
  }, [api, mois, auj])

  const actives = useMemo(() => (demandes ?? []).filter((d) => d.statut === 'accordee' || d.statut === 'en_attente'), [demandes])
  const travaille = (j: string) => (profil.minutes_jour?.[isodow(j) - 1] ?? (isodow(j) < 6 ? 1 : 0)) > 0

  const evenements = (j: string, ptsJour: Pointage[]): Evenement[] => {
    const r: Evenement[] = []
    const f = feries.find((x) => x.jour === j)
    if (f) return [{ genre: 'ferie', libelle: f.libelle }]
    const conges = travaille(j) ? actives.filter((d) => d.date_debut <= j && d.date_fin >= j) : []
    conges.forEach((d) => r.push({ genre: 'conge', d }))
    const congeJourEntier = conges.some((d) => d.statut === 'accordee' && d.type === 'conge_jours')
    if (ptsJour.some((p) => p.type_code === 'TT')) r.push({ genre: 'tt_fait' })
    else if (j >= auj && travaille(j) && !congeJourEntier && ttHabituel.includes(isodow(j))) r.push({ genre: 'tt_prevu' })
    return r
  }

  const grille = useMemo<Jour[]>(() => {
    const fin = finDuMois(mois)
    const debut = decalerJour(mois, -(isodow(mois) - 1)), dernier = decalerJour(fin, 7 - isodow(fin))
    const r: Jour[] = []
    for (let j = debut; j <= dernier; j = decalerJour(j, 1)) {
      const ptsJour = pts.filter((p) => p.jour === j).sort((a, b) => a.horodatage.localeCompare(b.horodatage))
      r.push({ jour: j, dansMois: j.slice(0, 7) === mois.slice(0, 7), repos: !travaille(j), evts: evenements(j, ptsJour), pts: ptsJour })
    }
    return r
  }, [mois, pts, actives, feries, ttHabituel])

  const duMois = grille.filter((g) => g.dansMois)
  const resume = {
    tt: duMois.filter((g) => g.evts.some((e) => e.genre === 'tt_fait')).length,
    ttPrevus: duMois.filter((g) => g.evts.some((e) => e.genre === 'tt_prevu')).length,
    conges: duMois.filter((g) => g.evts.some((e) => e.genre === 'conge' && e.d.statut === 'accordee')).length,
    attente: new Set(duMois.flatMap((g) => g.evts.filter((e) => e.genre === 'conge' && e.d.statut === 'en_attente').map((e) => (e as { d: Demande }).d.id))).size,
  }
  const jourChoisi = grille.find((g) => g.jour === choisi)
  const aller = (n: number) => { const m = decalerMois(mois, n); setMois(m); setChoisi(m.slice(0, 7) === auj.slice(0, 7) ? auj : m) }

  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>Mon agenda</h2>
            <div className="segments compact" role="radiogroup" aria-label="Affichage">
              <button type="button" role="radio" aria-checked={vue === 'mois'} onClick={() => setVue('mois')}>Mois</button>
              <button type="button" role="radio" aria-checked={vue === 'liste'} onClick={() => setVue('liste')}>À venir</button>
            </div>
          </div>
          {erreur && <p className="negatif">{erreur}</p>}

          {vue === 'mois' && <>
            <div className="nav-mois">
              <button className="bouton secondaire petit" onClick={() => aller(-1)} aria-label="Mois précédent">‹</button>
              <strong className="titre-mois" aria-live="polite">{MOIS.format(d12(mois))}</strong>
              <button className="bouton secondaire petit" onClick={() => aller(1)} aria-label="Mois suivant">›</button>
              {mois !== premierDuMois(auj) && <button className="lien petit" onClick={() => { setMois(premierDuMois(auj)); setChoisi(auj) }}>Aujourd’hui</button>}
            </div>

            <div className="resume-agenda">
              <span><strong>{resume.tt}</strong> jour{resume.tt > 1 ? 's' : ''} de télétravail pointé{resume.tt > 1 ? 's' : ''}</span>
              {resume.ttPrevus > 0 && <span><strong>{resume.ttPrevus}</strong> prévu{resume.ttPrevus > 1 ? 's' : ''}</span>}
              <span><strong>{resume.conges}</strong> jour{resume.conges > 1 ? 's' : ''} de congé accordé{resume.conges > 1 ? 's' : ''}</span>
              {resume.attente > 0 && <span className="attente-txt"><strong>{resume.attente}</strong> demande{resume.attente > 1 ? 's' : ''} en attente</span>}
            </div>

            <div className="grille-agenda" role="group" aria-label={`Jours de ${MOIS.format(d12(mois))}`}>
              {ENTETES.map((e) => <div key={e} className="entete-jour" aria-hidden="true">{e}</div>)}
              {grille.map((g) => {
                const classes = ['jour-agenda', g.dansMois ? '' : 'hors-mois', g.repos ? 'repos' : '', g.jour === auj ? 'aujourdhui' : '',
                  g.evts.some((e) => e.genre === 'ferie') ? 'ferie' : ''].filter(Boolean).join(' ')
                const description = `${dateLongue(g.jour)}${g.jour === auj ? ' (aujourd’hui)' : ''} : ${g.evts.length ? g.evts.map(texteEvt).join(', ') : g.repos ? 'jour non travaillé' : 'rien de prévu'}`
                return (
                  <button key={g.jour} className={classes} aria-pressed={choisi === g.jour} aria-label={description}
                          onClick={() => setChoisi(g.jour)}>
                    <span className="num-jour">{Number(g.jour.slice(8))}</span>
                    <span className="evts">{g.evts.map((e, i) => <Puce key={i} e={e} />)}</span>
                  </button>
                )
              })}
            </div>

            <ul className="legende-agenda" aria-label="Légende">
              <li><span className="evt tt-prevu">TT</span> Télétravail prévu (jour habituel)</li>
              <li><span className="evt tt-fait">TT</span> Télétravail pointé</li>
              <li><span className="evt conge accordee">Congé</span> Congé accordé</li>
              <li><span className="evt conge en_attente">Attente</span> Demande en attente</li>
              <li><span className="evt ferie">Férié</span> Jour férié</li>
              <li><span className="carre-repos" aria-hidden="true" /> Jour non travaillé</li>
            </ul>

            {jourChoisi && (
              <div className="detail-jour" aria-live="polite">
                <h3>{dateLongue(jourChoisi.jour)}{jourChoisi.jour === auj && <span className="doux petit"> · aujourd’hui</span>}</h3>
                {jourChoisi.evts.length === 0 && jourChoisi.pts.length === 0 &&
                  <p className="doux petit">{jourChoisi.repos ? 'Jour non travaillé selon ton régime.' : jourChoisi.jour < auj ? 'Aucun pointage.' : 'Rien de prévu : journée au bureau.'}</p>}
                <ul className="liste-detail">
                  {jourChoisi.evts.map((e, i) => (
                    <li key={i}><Puce e={e} /> <span>{texteEvt(e)}{e.genre === 'conge' && e.d.date_debut !== e.d.date_fin &&
                      <span className="doux"> · du {e.d.date_debut.slice(8)}/{e.d.date_debut.slice(5, 7)} au {e.d.date_fin.slice(8)}/{e.d.date_fin.slice(5, 7)}</span>}</span></li>
                  ))}
                </ul>
                {jourChoisi.pts.length > 0 && (
                  <p className="petit">Pointages : {jourChoisi.pts.map((p) => `${p.sens === 'entree' ? 'entrée' : 'sortie'} ${heure(p.horodatage)}${p.type_code === 'TT' ? ' (télétravail)' : ''}`).join(' · ')}</p>
                )}
                <div className="ligne">
                  {jourChoisi.jour >= auj && !jourChoisi.repos && !jourChoisi.evts.some((e) => e.genre !== 'tt_prevu') &&
                    <button className="bouton petit" onClick={onDemanderConge}>Demander un congé</button>}
                  <button className="lien petit" onClick={onVoirCompte}>Mes jours de télétravail : {ttHabituel.length ? ttHabituel.map((j) => ENTETES[j - 1].toLowerCase()).join(', ') : 'aucun'} · modifier</button>
                </div>
              </div>
            )}
          </>}

          {vue === 'liste' && <AVenir demandes={actives} feries={feries} auj={auj} ttHabituel={ttHabituel} onDemanderConge={onDemanderConge} />}
        </section>
      </div>
    </main>
  )
}

function Puce({ e }: { e: Evenement }) {
  if (e.genre === 'ferie') return <span className="evt ferie" title={e.libelle}><span className="long">{e.libelle}</span><span className="court">Férié</span></span>
  if (e.genre === 'tt_fait') return <span className="evt tt-fait">TT</span>
  if (e.genre === 'tt_prevu') return <span className="evt tt-prevu">TT</span>
  const court = e.d.statut === 'accordee' ? (e.d.type === 'conge_jours' ? 'Congé' : '½ congé') : 'Attente'
  return <span className={`evt conge ${e.d.statut}`}><span className="long">{e.d.statut === 'accordee' ? libelleConge(e.d) : `${e.d.libelle_absence} (attente)`}</span><span className="court">{court}</span></span>
}

function AVenir({ demandes, feries, auj, ttHabituel, onDemanderConge }: {
  demandes: Demande[]; feries: Ferie[]; auj: string; ttHabituel: number[]; onDemanderConge: () => void
}) {
  const limite = decalerJour(auj, 366)
  const items = [
    ...demandes.filter((d) => d.date_fin >= auj).map((d) => ({ debut: d.date_debut, fin: d.date_fin, d, ferie: null as Ferie | null })),
    ...feries.filter((f) => f.jour >= auj && f.jour <= limite).map((f) => ({ debut: f.jour, fin: f.jour, d: null as Demande | null, ferie: f })),
  ].sort((a, b) => a.debut.localeCompare(b.debut))
  let moisCourant = ''
  return (
    <div className="a-venir">
      <p className="petit">Télétravail habituel : <strong>{ttHabituel.length ? ttHabituel.map((j) => ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][j - 1]).join(', ') : 'aucun'}</strong></p>
      {items.length === 0 && <p className="vide">Rien de prévu pour l’instant. <button className="lien" onClick={onDemanderConge}>Demander un congé</button></p>}
      <ul className="liste">
        {items.map((it) => {
          const m = it.debut.slice(0, 7)
          const titreMois = m !== moisCourant ? (moisCourant = m) : null
          const dans = nbJours(auj, it.debut)
          return (
            <li key={(it.d?.id ?? it.ferie!.jour)} className={`item-avenir ${titreMois ? 'nouveau-mois' : ''}`}>
              <div className="bloc-date" aria-hidden="true"><span>{Number(it.debut.slice(8))}</span><small>{MOIS_COURT.format(d12(it.debut)).replace('.', '')}</small></div>
              <div className="texte-ligne">
                {titreMois && <div className="groupe-titre">{MOIS.format(d12(it.debut))}</div>}
                <div><strong>{it.d ? libelleConge(it.d) : `Férié : ${it.ferie!.libelle}`}</strong></div>
                <div className="doux petit">
                  {it.debut === it.fin ? dateLongue(it.debut) : `du ${JOUR_SEM.format(d12(it.debut))} ${Number(it.debut.slice(8))} au ${JOUR_SEM.format(d12(it.fin))} ${Number(it.fin.slice(8))} ${MOIS_COURT.format(d12(it.fin)).replace('.', '')}`}
                  {' · '}{it.debut === auj ? 'aujourd’hui' : it.debut < auj ? 'en cours' : dans === 1 ? 'demain' : `dans ${dans} jours`}
                </div>
              </div>
              {it.d && <span className={`pilule ${it.d.statut === 'accordee' ? 'ok' : 'attente'}`}>{it.d.statut === 'accordee' ? 'Accordé ✓' : 'En attente'}</span>}
              {it.ferie && <span className="pilule neutre">Férié</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
