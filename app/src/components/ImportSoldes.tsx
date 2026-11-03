import { useEffect, useMemo, useState } from 'react'
import type { AdminPersonne, Api, Compteur } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { duree, jourBxl } from '../lib/temps'
import { telecharger } from '../lib/export'
import { lireCsv } from './ImportPersonnes'
import Fenetre from './Fenetre'

const sa = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
/** « 114:30 », « 114h30 », « 114,5 », « -3:48 » → minutes ; null si illisible */
export function versMinutes(v: string): number | null {
  const t = v.trim().replace(/\s/g, '')
  const hm = t.match(/^(-?)(\d+)[:h](\d{1,2})$/i)
  if (hm) return (hm[1] ? -1 : 1) * (Number(hm[2]) * 60 + Number(hm[3]))
  const d = t.replace(',', '.'); if (/^-?\d+(\.\d+)?$/.test(d)) return Math.round(Number(d) * 60)
  return null
}
const versDate = (v: string) => { const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim() }

/**
 * Reprise des soldes (ex. export Dinclock) : un fichier CSV « email ; compteur ; solde ; date », vérifié ligne par ligne,
 * puis enregistré comme solde d'ouverture (tracé dans l'historique de chaque personne, motif « Reprise »).
 */
export default function ImportSoldes({ api, personnes, onFermer, onFait }: {
  api: Api; personnes: AdminPersonne[]; onFermer: () => void; onFait: (n: number) => void
}) {
  const [compteurs, setCompteurs] = useState<Compteur[]>([])
  const [brut, setBrut] = useState<string[][] | null>(null)
  const [motif, setMotif] = useState('Reprise des soldes Dinclock')
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState<string | null>(null)
  useEffect(() => { api.compteurs().then((c) => setCompteurs(c.filter((x) => x.actif && x.code !== 'BONI'))).catch(() => {}) }, [api])

  const lignes = useMemo(() => {
    if (!brut?.length) return []
    const e = brut[0].map(sa), col = (r: string[], n: string) => (r[e.indexOf(n)] ?? '').trim()
    const vus = new Set<string>()
    return brut.slice(1).map((r) => {
      const email = col(r, 'email').toLowerCase(), cpt = col(r, 'compteur'), solde = col(r, 'solde'), date = versDate(col(r, 'date')) || jourBxl()
      const p = personnes.find((x) => x.email.toLowerCase() === email)
      const c = compteurs.find((x) => sa(x.code) === sa(cpt) || sa(x.libelle) === sa(cpt))
      const minutes = versMinutes(solde)
      const cle = `${email}|${c?.code}`
      const erreurs = [!p && `personne inconnue (${email || 'e-mail vide'})`, !c && `compteur inconnu (${cpt || 'vide'})`,
        minutes === null && `solde illisible (${solde || 'vide'})`, !/^\d{4}-\d{2}-\d{2}$/.test(date) && `date illisible`,
        vus.has(cle) && 'doublon dans le fichier'].filter(Boolean) as string[]
      vus.add(cle)
      return { p, c, minutes: minutes ?? 0, date, erreurs }
    })
  }, [brut, personnes, compteurs])
  const prets = lignes.filter((l) => !l.erreurs.length)

  return (
    <Fenetre titre="Reprendre des soldes" onFermer={onFermer} large>
      <p className="doux petit" style={{ marginTop: 0 }}>Un fichier CSV avec les colonnes <strong>email ; compteur ; solde ; date</strong>.
        Compteur : son code ou son nom (ex. « Congés annuels »). Solde en heures : « 114:30 », « 114h30 » ou « 114,5 ». Date facultative
        (par défaut aujourd’hui). Chaque solde est enregistré comme <strong>solde d’ouverture</strong>, visible dans l’historique de la personne.</p>
      <div className="ligne" style={{ flexWrap: 'wrap' }}>
        <button className="bouton secondaire petit" onClick={() => telecharger([['email', 'compteur', 'solde', 'date'],
          ...personnes.filter((p) => !p.date_sortie).slice(0, 2).map((p) => [p.email, compteurs[0]?.libelle ?? 'Congés annuels', '114:00', ''])], 'modele-soldes', 'csv')}>
          Télécharger un modèle</button>
        <label className="bouton petit" style={{ cursor: 'pointer' }}>Choisir le fichier
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setResultat(null); setBrut(lireCsv(await f.text())) } }} /></label>
      </div>
      {brut && (
        <>
          <p className="petit"><strong>{prets.length}</strong> solde(s) prêt(s){lignes.length - prets.length ? <> · <span className="negatif">{lignes.length - prets.length} à corriger dans le fichier</span></> : ''}</p>
          <div className="tableau-defilant" style={{ maxHeight: 320 }} tabIndex={0} role="region" aria-label="Aperçu des soldes, défilable">
            <table className="tableau">
              <thead><tr><th>Personne</th><th>Compteur</th><th className="num">Solde</th><th>Date</th><th>État</th></tr></thead>
              <tbody>{lignes.map((l, i) => (
                <tr key={i}><td>{l.p ? `${l.p.nom} ${l.p.prenom}` : '—'}</td><td>{l.c?.libelle ?? '—'}</td>
                  <td className="num">{l.erreurs.length ? '—' : duree(l.minutes, true)}</td><td>{l.date}</td>
                  <td>{l.erreurs.length ? <span className="negatif petit">{l.erreurs.join(' · ')}</span> : <span className="pilule ok">Prêt</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <label className="champ">Motif (visible dans l’historique)<input id="soldes-motif" value={motif} required onChange={(e) => setMotif(e.target.value)} /></label>
        </>
      )}
      {resultat && <p className="petit" role="status">{resultat}</p>}
      <div className="actions">
        <button className="bouton secondaire" onClick={onFermer}>{resultat ? 'Terminé' : 'Annuler'}</button>
        {!resultat && <button className="bouton" disabled={!prets.length || enCours || !motif.trim()} onClick={async () => {
          setEnCours(true); let n = 0; const ko: string[] = []
          for (const l of prets) {
            try { await api.reprendreSolde(l.p!.id, l.c!.code, l.minutes, l.date, motif.trim()); n++ } catch (e) { ko.push(`${l.p!.prenom} ${l.p!.nom} : ${messageErreur(e)}`) }
          }
          setEnCours(false); setResultat(`${n} solde(s) repris.${ko.length ? ` Échecs : ${ko.join(' ; ')}` : ''}`); onFait(n)
        }}>{enCours ? 'Enregistrement…' : `Reprendre ${prets.length} solde(s)`}</button>}
      </div>
    </Fenetre>
  )
}
