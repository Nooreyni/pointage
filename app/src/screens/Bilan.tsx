import { useEffect, useMemo, useState } from 'react'
import type { Api, LigneMensuelle } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { telecharger, type Format } from '../lib/export'
import Export from '../components/Export'
import { duree, jourBxl } from '../lib/temps'

const MOIS = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const nomMois = (iso: string) => MOIS.format(new Date(`${iso}T12:00:00Z`))
function moisDisponibles(): string[] {
  const r: string[] = [], d = new Date(`${jourBxl().slice(0, 8)}01T12:00:00Z`)
  for (let i = 0; i < 13; i++) { r.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() - 1) }
  return r
}
const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** « Ce mois » : présences, absences, télétravail et jours à régulariser par personne. Équipe pour un chef, tout le CFB pour la RH et la direction. */
export default function Bilan({ api, onOuvrirFiche }: { api: Api; onOuvrirFiche?: (id: string) => void }) {
  const mois = useMemo(moisDisponibles, [])
  const [choix, setChoix] = useState(Number(jourBxl().slice(8)) <= 3 ? mois[1] : mois[0])   // début de mois : le mois écoulé
  const [lignes, setLignes] = useState<LigneMensuelle[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')
  const [aRegler, setARegler] = useState(false)
  useEffect(() => { setLignes(null); setErreur(null); api.rapportMensuel(choix).then(setLignes).catch((e) => setErreur(messageErreur(e))) }, [api, choix])

  const visibles = (lignes ?? []).filter((l) => (!aRegler || l.jours_non_justifies + l.jours_incomplets > 0)
    && (!filtre || sansAccent(`${l.nom} ${l.prenom} ${l.service}`).includes(sansAccent(filtre))))
  const t = visibles.reduce((a, l) => ({ prevus: a.prevus + l.jours_prevus, presents: a.presents + l.jours_presents, tt: a.tt + l.jours_tt,
    regul: a.regul + l.jours_non_justifies + l.jours_incomplets, personnesRegul: a.personnesRegul + (l.jours_non_justifies + l.jours_incomplets > 0 ? 1 : 0) }),
    { prevus: 0, presents: 0, tt: 0, regul: 0, personnesRegul: 0 })
  const plusieursServices = new Set((lignes ?? []).map((l) => l.service)).size > 1

  function exporter(format: Format) {
    if (!lignes) return
    const h = (m: number) => (m / 60).toFixed(2).replace('.', ',')
    telecharger([['Nom', 'Prénom', 'Service', 'Régime', 'Jours prévus', 'Jours pointés', 'Jours télétravail', 'Heures à prester', 'Heures prestées', 'Boni (h)',
      'Congés (h)', 'Maladie (h)', 'Autres absences (h)', 'Jours sans pointage', 'Jours incomplets'],
      ...lignes.map((l) => [l.nom, l.prenom, l.service, l.regime ?? '', l.jours_prevus, l.jours_presents, l.jours_tt, h(l.a_prester), h(l.preste), h(l.boni),
        h(l.conges), h(l.maladie), h(l.autres_absences), l.jours_non_justifies, l.jours_incomplets])], `recap-${choix.slice(0, 7)}`, format, `Récap ${choix.slice(0, 7)}`)
  }

  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>Ce mois <span className="doux petit">· {nomMois(choix)}</span></h2>
            <span className="ligne">
              <select id="bilan-mois" className="choix-mois" aria-label="Mois" value={choix} onChange={(e) => setChoix(e.target.value)}>
                {mois.map((m, i) => <option key={m} value={m}>{nomMois(m)}{i === 0 ? ' (en cours)' : ''}</option>)}
              </select>
              <Export disabled={!lignes?.length} onExporter={exporter} />
            </span>
          </div>
          {lignes && lignes.length > 0 && (
            <div className="tuiles bilan-tuiles">
              <div className="tuile"><strong>{t.prevus ? Math.round((100 * t.presents) / t.prevus) : 0} %</strong><span>des jours prévus pointés</span></div>
              <div className="tuile"><strong>{t.tt}</strong><span>jours de télétravail</span></div>
              <div className={`tuile ${t.regul ? 'alerte' : ''}`}><strong>{t.regul}</strong><span>jour(s) à régulariser · {t.personnesRegul} pers.</span></div>
              <div className="tuile"><strong>{visibles.length}</strong><span>personne(s)</span></div>
            </div>
          )}
          <div className="ligne filtres-bilan">
            {(lignes?.length ?? 0) > 6 && <input id="bilan-filtre" type="search" className="recherche" placeholder={plusieursServices ? 'Personne ou service…' : 'Personne…'} aria-label="Filtrer" value={filtre} onChange={(e) => setFiltre(e.target.value)} />}
            <label className="case-a-cocher petit" style={{ margin: 0 }}><input type="checkbox" checked={aRegler} onChange={(e) => setARegler(e.target.checked)} />Seulement à régulariser</label>
          </div>
          {erreur && <p className="negatif">{erreur}</p>}
          {!lignes && !erreur && <p className="vide">Calcul…</p>}
          {lignes?.length === 0 && <p className="vide">Personne à afficher pour ce mois.</p>}
          {visibles.length > 0 && (
            <div className="tableau-defilant">
              <table className="tableau">
                <thead><tr>
                  <th>Personne</th>{plusieursServices && <th className="masque-mobile">Service</th>}
                  <th className="num">Jours pointés</th><th className="num">Heures</th><th className="num masque-mobile">Boni</th>
                  <th className="num">Absences</th><th className="num masque-mobile">Télétravail</th><th className="num">À régulariser</th>
                </tr></thead>
                <tbody>{visibles.map((l) => {
                  const regul = l.jours_non_justifies + l.jours_incomplets
                  const abs = l.conges + l.maladie + l.autres_absences
                  return (
                    <tr key={l.personne_id}>
                      <td>{onOuvrirFiche ? <button className="lien-nom" onClick={() => onOuvrirFiche(l.personne_id)} title="Voir sa fiche de temps">{l.nom} {l.prenom}</button>
                                         : <strong>{l.nom} {l.prenom}</strong>}</td>
                      {plusieursServices && <td className="masque-mobile">{l.service}</td>}
                      <td className="num">{l.jours_presents}<span className="doux"> / {l.jours_prevus}</span></td>
                      <td className="num">{duree(l.preste)}</td>
                      <td className={`num masque-mobile ${l.boni < 0 ? 'negatif' : l.boni > 0 ? 'positif' : ''}`}>{l.boni ? duree(l.boni, true) : '—'}</td>
                      <td className="num" title={abs ? `Congés ${duree(l.conges)} · maladie ${duree(l.maladie)} · autres ${duree(l.autres_absences)}` : undefined}>{abs ? duree(abs) : '—'}</td>
                      <td className="num masque-mobile">{l.jours_tt || '—'}</td>
                      <td className="num">{regul ? <span className="pilule attente">{regul} j</span> : <span className="doux">—</span>}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
          <p className="doux petit" style={{ marginBottom: 0 }}>Jusqu’à hier. Clique sur un nom pour voir sa fiche de temps jour par jour. L’export contient le détail (congés, maladie, autres absences).</p>
        </section>
      </div>
    </main>
  )
}
