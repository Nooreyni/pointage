import { useMemo, useState } from 'react'
import type { AdminService, Api, Regime, Role, SaisiePersonne } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { telecharger } from '../lib/export'
import Fenetre from './Fenetre'

const COLONNES = ['prenom', 'nom', 'email', 'service', 'role', 'date_entree', 'regime', 'matricule']
const ROLES: Record<string, Role> = { employe: 'employe', 'employé': 'employe', rh: 'rh', 'admin rh': 'admin_rh', admin_rh: 'admin_rh', direction: 'direction',
  'responsable isp': 'responsable_isp', responsable_isp: 'responsable_isp', admin: 'admin' }
const sa = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Lecture CSV simple : « ; » ou « , », guillemets, BOM. */
export function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, ''), sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) >= (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const lignes: string[][] = []; let cell = '', ligne: string[] = [], q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c; continue }
    if (c === '"') q = true; else if (c === sep) { ligne.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; ligne.push(cell); if (ligne.some((x) => x.trim())) lignes.push(ligne); ligne = []; cell = '' }
    else cell += c
  }
  ligne.push(cell); if (ligne.some((x) => x.trim())) lignes.push(ligne)
  return lignes
}
const versDate = (v: string) => { const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim() }

/** Import en masse (reprise depuis Dinclock, arrivée d'un groupe) : modèle à télécharger, aperçu vérifié ligne par ligne, puis création. */
export default function ImportPersonnes({ api, services, regimes, existants, onFermer, onFait }: {
  api: Api; services: AdminService[]; regimes: Regime[]; existants: string[]; onFermer: () => void; onFait: (n: number) => void
}) {
  const [brut, setBrut] = useState<string[][] | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState<string | null>(null)

  const lignes = useMemo(() => {
    if (!brut?.length) return []
    const entetes = brut[0].map(sa)
    const col = (r: string[], nom: string) => (r[entetes.indexOf(nom)] ?? '').trim()
    return brut.slice(1).map((r) => {
      const service = services.find((s) => sa(s.nom) === sa(col(r, 'service')))
      const regime = regimes.find((x) => x.actif && sa(x.libelle) === sa(col(r, 'regime'))) ?? (col(r, 'regime') ? undefined : regimes.find((x) => x.actif))
      const role = ROLES[sa(col(r, 'role') || 'employe')]
      const email = col(r, 'email').toLowerCase(), date = versDate(col(r, 'date_entree'))
      const erreurs = [
        !col(r, 'prenom') || !col(r, 'nom') ? 'nom ou prénom manquant' : '',
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'e-mail invalide' : existants.includes(email) ? 'existe déjà' : '',
        !service ? `service « ${col(r, 'service')} » inconnu` : '', !role ? `rôle « ${col(r, 'role')} » inconnu` : '',
        !regime ? `régime « ${col(r, 'regime')} » inconnu` : '', !col(r, 'date_entree') ? 'date d’entrée manquante' : !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'date d’entrée invalide' : '',
      ].filter(Boolean)
      const saisie: SaisiePersonne = { id: null, prenom: col(r, 'prenom'), nom: col(r, 'nom'), email, service_id: service?.id ?? '', role: role ?? 'employe',
        type: 'interne', partenaire_isp: null, matricule: col(r, 'matricule') || null, date_entree: date, date_sortie: null, regime_id: regime?.id ?? null }
      return { saisie, erreurs, service: service?.nom ?? col(r, 'service'), regime: regime?.libelle ?? col(r, 'regime') }
    })
  }, [brut, services, regimes, existants])
  const valides = lignes.filter((l) => !l.erreurs.length)

  return (
    <Fenetre titre="Importer des personnes" onFermer={onFermer} large>
      {!brut && <>
        <p className="petit" style={{ marginTop: 0 }}>Un fichier CSV (Excel : « Enregistrer sous… CSV »), une ligne par personne. Colonnes : {COLONNES.join(', ')}.
          Le rôle par défaut est « employé » ; le régime par défaut est le premier régime actif.</p>
        <div className="ligne">
          <label className="bouton">Choisir le fichier<input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setBrut(lireCsv(await f.text())) }} /></label>
          <button className="lien petit" onClick={() => telecharger([COLONNES, ['Sofia', 'Janssens', 'sofia.janssens@cfb.be', services[0]?.nom ?? 'SAF', 'employe', '01/09/2024', regimes[0]?.libelle ?? '', '']], 'modele-import-personnes', 'csv')}>
            Télécharger le modèle</button>
        </div>
      </>}
      {brut && !resultat && <>
        <p className="petit" style={{ marginTop: 0 }}><strong>{valides.length}</strong> prête(s) à créer{lignes.length - valides.length > 0 && <> · <span className="negatif">{lignes.length - valides.length} à corriger dans le fichier</span></>}</p>
        <div className="tableau-defilant" style={{ maxHeight: 340 }} tabIndex={0} role="region" aria-label="Aperçu de l’import, défilable">
          <table className="tableau">
            <thead><tr><th>Personne</th><th>Service</th><th className="masque-mobile">Régime</th><th>État</th></tr></thead>
            <tbody>{lignes.map((l, i) => (
              <tr key={i}><td><strong>{l.saisie.nom} {l.saisie.prenom}</strong><div className="doux petit">{l.saisie.email}</div></td><td>{l.service}</td>
                <td className="masque-mobile petit">{l.regime}</td>
                <td>{l.erreurs.length ? <span className="negatif petit">{l.erreurs.join(' · ')}</span> : <span className="pilule ok">Prête</span>}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="actions">
          <button className="bouton secondaire" onClick={() => setBrut(null)}>Autre fichier</button>
          <button className="bouton" disabled={!valides.length || enCours} onClick={async () => {
            setEnCours(true); let n = 0; const echecs: string[] = []
            for (const l of valides) { try { await api.enregistrerPersonne(l.saisie); n++ } catch (e) { echecs.push(`${l.saisie.email} : ${messageErreur(e)}`) } }
            setEnCours(false); setResultat(`${n} personne(s) créée(s).${echecs.length ? ` Échecs : ${echecs.join(' · ')}` : ''}`); onFait(n)
          }}>{enCours ? 'Création…' : `Créer ${valides.length} personne(s)`}</button>
        </div>
      </>}
      {resultat && <>
        <p>{resultat}</p>
        <p className="doux petit">Prochaines étapes pour chacune (fiche › Arrivée) : mot de passe, congés de l’année, jours de télétravail.</p>
        <div className="actions"><button className="bouton" onClick={onFermer}>Terminé</button></div>
      </>}
    </Fenetre>
  )
}
