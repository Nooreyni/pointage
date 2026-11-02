import { useEffect, useMemo, useState } from 'react'
import { IcCorrection, IcDiffere, IcEntree, IcSortie } from '../components/Icones'
import type { Api, Demande, Journee, PersonneVisible, Pointage, Profil } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { telecharger, type Format } from '../lib/export'
import Export from '../components/Export'
import TeletravailHabituel from '../components/TeletravailHabituel'
import { useNav } from '../lib/navigation'
import { dateCourte, decalerJour, duree, heure, jourBxl } from '../lib/temps'

const MOIS = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const nomMois = (iso: string) => MOIS.format(new Date(`${iso}T12:00:00Z`))
const finDuMois = (m: string) => { const d = new Date(`${m}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) }
function moisDisponibles(): string[] {
  const r: string[] = [], d = new Date(`${jourBxl().slice(0, 8)}01T12:00:00Z`)
  for (let i = 0; i < 13; i++) { r.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() - 1) }
  return r
}

interface Ligne { j: Journee; pts: Pointage[]; absence: Demande | undefined }

/** Fiche de temps mensuelle : « Mes heures » pour chacun, fiche d'une personne pour N+1 / RH / direction. */
export default function Heures({ api, profil, personneInitiale }: { api: Api; profil: Profil; personneInitiale?: string | null }) {
  const mois = useMemo(moisDisponibles, [])
  // Le 1er du mois, aucun jour n'est encore écoulé : on ouvre le mois précédent
  const [choixMois, setChoixMois] = useState(jourBxl().endsWith('-01') ? mois[1] : mois[0])
  const [personnes, setPersonnes] = useState<PersonneVisible[]>([])
  const [qui, setQui] = useState<string>(personneInitiale ?? profil.id)
  const [lignes, setLignes] = useState<Ligne[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [toutVoir, setToutVoir] = useState(false)

  useEffect(() => { api.personnesVisibles().then(setPersonnes).catch(() => setPersonnes([])) }, [api])
  useEffect(() => { if (personneInitiale) setQui(personneInitiale) }, [personneInitiale])

  useEffect(() => {
    let actif = true
    const fin = finDuMois(choixMois) < jourBxl() ? finDuMois(choixMois) : decalerJour(jourBxl(), -1)
    setLignes(null); setErreur(null)
    if (fin < choixMois) { setLignes([]); return }
    Promise.all([api.journeesPersonne(qui, choixMois, fin), api.pointagesPersonne(qui, choixMois, fin), api.absencesPersonne(qui, choixMois, fin)])
      .then(([js, pts, abs]) => {
        if (!actif) return
        setLignes(js.map((j) => ({ j, pts: pts.filter((p) => p.jour === j.jour && !p.annule).sort((a, b) => a.horodatage.localeCompare(b.horodatage)),
                                   absence: abs.find((a) => a.date_debut <= j.jour && a.date_fin >= j.jour) })))
      })
      .catch((e) => { if (actif) setErreur(messageErreur(e)) })
    return () => { actif = false }
  }, [api, qui, choixMois])

  const autres = personnes.filter((p) => p.id !== profil.id)
  const nav = useNav()
  const nomQui = qui === profil.id ? 'Mes heures' : (() => { const p = personnes.find((x) => x.id === qui); return p ? `${p.prenom} ${p.nom}` : 'Fiche de temps' })()
  const tot = (lignes ?? []).reduce((t, { j }) => ({ aPrester: t.aPrester + j.a_prester, preste: t.preste + j.preste, boni: t.boni + j.boni,
    regul: t.regul + ((j.nb_pointages === 0 && j.a_prester > 0) || (j.nb_pointages > 0 && !j.complete) ? 1 : 0),
    absence: t.absence + j.absence }), { aPrester: 0, preste: 0, boni: 0, regul: 0, absence: 0 })
  const visibles = (lignes ?? []).filter(({ j, pts }) => toutVoir || j.prevues > 0 || pts.length > 0)

  function exporter(format: Format) {
    if (!lignes) return
    const h = (m: number) => (m / 60).toFixed(2).replace('.', ',')
    const entete = ['Date', 'Prévu (h)', 'Absence', 'Absence (h)', 'Pointages', 'Prestées (h)', 'Boni (h)', 'Statut']
    const corps = lignes.map(({ j, pts, absence }) => [j.jour, h(j.prevues), absence?.libelle_absence ?? '', h(j.absence),
      pts.map((p) => `${p.sens === 'entree' ? 'E' : 'S'} ${heure(p.horodatage)}`).join(' '), h(j.preste), h(j.boni), statut(j).texte])
    telecharger([entete, ...corps], `fiche-temps-${nomQui.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${choixMois.slice(0, 7)}`, format, `Fiche de temps ${choixMois.slice(0, 7)}`)
  }

  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>{nomQui} <span className="doux petit">· {nomMois(choixMois)}</span>
              {qui !== profil.id && nav.ficheRH && <button className="lien petit" onClick={() => nav.naviguer({ vers: 'personne', id: qui })}>Fiche RH</button>}</h2>
            <span className="ligne outils-fiche">
              {autres.length > 0 && (
                <select id="fiche-personne" aria-label="Personne" value={qui} onChange={(e) => setQui(e.target.value)}>
                  <option value={profil.id}>Moi</option>
                  {[...new Set(autres.map((p) => p.service))].sort().map((s) => (
                    <optgroup key={s} label={s}>{autres.filter((p) => p.service === s).sort((a, b) => a.nom.localeCompare(b.nom))
                      .map((p) => <option key={p.id} value={p.id}>{p.nom} {p.prenom}</option>)}</optgroup>
                  ))}
                </select>
              )}
              <select id="fiche-mois" aria-label="Mois" value={choixMois} onChange={(e) => setChoixMois(e.target.value)}>
                {mois.map((m, i) => <option key={m} value={m}>{nomMois(m)}{i === 0 ? ' (en cours)' : ''}</option>)}
              </select>
            </span>
          </div>
          <TeletravailHabituel api={api} personneId={qui} moi={qui === profil.id} />
          <div className="tuiles fiche-tuiles">
            <div className="tuile"><strong>{duree(tot.preste)}</strong><span>prestées</span><small className="doux">sur {duree(tot.aPrester)} à prester</small></div>
            <div className="tuile"><strong className={tot.boni < 0 ? 'negatif' : 'positif'}>{duree(tot.boni, true)}</strong><span>boni du mois</span></div>
            <div className="tuile"><strong>{duree(tot.absence)}</strong><span>d’absence (congés…)</span></div>
            <div className={`tuile ${tot.regul ? 'alerte' : ''}`}><strong>{tot.regul}</strong><span>jour(s) à régulariser</span></div>
          </div>
        </section>

        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>Jour par jour</h2>
            <span className="ligne outils-jours">
              <label className="case-a-cocher petit" style={{ margin: 0 }}>
                <input type="checkbox" checked={toutVoir} onChange={(e) => setToutVoir(e.target.checked)} />Week-ends et jours non prestés</label>
              <button className="bouton secondaire petit" onClick={() => window.print()}>Imprimer</button>
              <Export disabled={!lignes?.length} onExporter={exporter} />
            </span>
          </div>
          {erreur && <p className="negatif">{erreur}</p>}
          {!lignes && !erreur && <p className="vide">Chargement…</p>}
          {lignes?.length === 0 && <p className="vide">Aucun jour écoulé sur ce mois.</p>}
          {lignes && lignes.length > 0 && visibles.length === 0 && (
            <p className="vide">Pas encore de jour ouvrable écoulé ce mois-ci. <button className="lien petit" onClick={() => setToutVoir(true)}>Voir tous les jours</button></p>
          )}
          {lignes && visibles.length > 0 && (
            <div className="tableau-defilant">
              <table className="tableau fiche">
                <thead><tr><th>Jour</th><th className="num">Prévu</th><th>Pointages</th><th className="num">Prestées</th><th className="num">Boni</th><th>Statut</th></tr></thead>
                <tbody>{visibles.map(({ j, pts, absence }) => {
                  const st = statut(j)
                  return (
                    <tr key={j.jour} className={j.prevues === 0 && !pts.length ? 'repos' : ''}>
                      <td><strong>{dateCourte(j.jour)}</strong></td>
                      <td className="num">{j.prevues ? duree(j.prevues) : '—'}</td>
                      <td className="cellule-pointages">
                        {pts.map((p) => (
                          <span key={p.id} className={`puce-pointage ${p.sens}`} title={`${p.sens === 'entree' ? 'Entrée' : 'Sortie'} · ${p.type_code}${p.differe ? ' · différé' : ''}`}>
                            {p.sens === 'entree' ? <IcEntree size={12} /> : <IcSortie size={12} />}{heure(p.horodatage)}{p.source === 'correction' && <IcCorrection />}{p.differe && <IcDiffere />}
                          </span>
                        ))}
                        {absence && <span className="pilule neutre">{absence.libelle_absence}{absence.type === 'conge_demi_jour' ? ' (½)' : ''}</span>}
                        {!pts.length && !absence && j.prevues > 0 && <span className="doux petit">aucun pointage</span>}
                      </td>
                      <td className="num">{j.preste ? duree(j.preste) : '—'}</td>
                      <td className={`num ${j.boni < 0 ? 'negatif' : j.boni > 0 ? 'positif' : ''}`}>{j.boni ? duree(j.boni, true) : '—'}</td>
                      <td><span className={`pilule ${st.classe}`}>{st.texte}</span></td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
          <p className="doux petit" style={{ marginBottom: 0 }}>
            <span className="legende-icone"><IcCorrection /> correction d’oubli</span> · <span className="legende-icone"><IcDiffere /> envoyé en différé (hors ligne)</span>. La pause de midi est déduite automatiquement selon les paramètres.
          </p>
        </section>
      </div>
    </main>
  )
}

function statut(j: Journee): { texte: string; classe: string } {
  if (j.nb_pointages === 0 && j.a_prester > 0) return { texte: 'À régulariser', classe: 'ko' }
  if (j.nb_pointages > 0 && !j.complete) return { texte: 'Sortie manquante', classe: 'attente' }
  if (j.depassement > 0) return { texte: 'Au-delà du max', classe: 'attente' }
  if (j.prevues > 0 && j.a_prester === 0) return { texte: 'Absent (justifié)', classe: 'neutre' }
  if (j.prevues === 0 && j.nb_pointages === 0) return { texte: 'Repos', classe: 'neutre' }
  return { texte: 'OK', classe: 'ok' }
}
