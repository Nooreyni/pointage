import { useEffect, useMemo, useRef, useState } from 'react'
import type { Api, Parametre, Presence, Profil } from '../lib/types'
import { useDialogue } from './useDialogue'

export type Cible =
  | { type: 'onglet'; onglet: string }
  | { type: 'personne'; id: string; nom: string; service: string; fiche: boolean }
  | { type: 'service'; nom: string }
  | { type: 'parametre'; cle: string }

interface Resultat { cle: string; titre: string; detail: string; groupe: string; cible: Cible; texte: string }

const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Recherche globale (bouton loupe ou Ctrl+K) : écrans, personnes, services, réglages (admin).
 * Personne : ouvre sa fiche de temps si on en a le droit, sinon la retrouve dans Équipe.
 */
export default function Recherche({ api, profil, onglets, onChoisir, onFermer }: {
  api: Api; profil: Profil; onglets: [string, string][]; onChoisir: (c: Cible) => void; onFermer: () => void
}) {
  const ref = useDialogue<HTMLDivElement>(onFermer)
  const champ = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [actif, setActif] = useState(0)
  const [personnes, setPersonnes] = useState<Presence[]>([])
  const [parametres, setParametres] = useState<Parametre[]>([])
  const admin = ['admin', 'admin_rh', 'direction'].includes(profil.role)
  const voitTout = ['rh', 'admin_rh', 'admin', 'direction'].includes(profil.role)

  useEffect(() => {
    api.presence().then(setPersonnes).catch(() => {})
    if (admin) api.parametres().then(setParametres).catch(() => {})
    champ.current?.focus()
  }, [api, admin])

  const tous = useMemo<Resultat[]>(() => {
    const r: Resultat[] = onglets.map(([id, libelle]) => ({
      cle: `o-${id}`, titre: libelle, detail: 'Écran', groupe: 'Écrans', cible: { type: 'onglet', onglet: id }, texte: libelle }))
    r.push({ cle: 'a-conge', titre: 'Demander un congé', detail: 'Congés', groupe: 'Écrans', cible: { type: 'onglet', onglet: 'conges' }, texte: 'demander conge vacances absence' })
    r.push({ cle: 'a-mdp', titre: 'Changer mon mot de passe', detail: 'Mon compte', groupe: 'Écrans', cible: { type: 'onglet', onglet: 'compte' }, texte: 'mot de passe changer compte profil' })
    r.push({ cle: 'a-tt', titre: 'Mes jours de télétravail', detail: 'Mon compte', groupe: 'Écrans', cible: { type: 'onglet', onglet: 'compte' }, texte: 'teletravail tt jours habituels domicile' })
    r.push({ cle: 'a-agenda', titre: 'Mon agenda du mois', detail: 'Agenda', groupe: 'Écrans', cible: { type: 'onglet', onglet: 'agenda' }, texte: 'agenda calendrier planning mois conges prevus' })
    r.push({ cle: 'a-notif', titre: 'Activer les notifications', detail: 'Alertes', groupe: 'Écrans', cible: { type: 'onglet', onglet: 'alertes' }, texte: 'notifications rappels push' })
    for (const p of personnes) {
      const fiche = voitTout || (profil.est_chef_service && p.mon_service)
      r.push({ cle: `p-${p.personne_id}`, titre: `${p.prenom} ${p.nom}`, detail: `${p.service} · ${p.statut}`, groupe: 'Personnes',
               cible: { type: 'personne', id: p.personne_id, nom: `${p.prenom} ${p.nom}`, service: p.service, fiche }, texte: `${p.prenom} ${p.nom} ${p.nom} ${p.prenom}` })
    }
    for (const s of [...new Set(personnes.map((p) => p.service))].sort()) {
      const n = personnes.filter((p) => p.service === s).length
      r.push({ cle: `s-${s}`, titre: s, detail: `Service · ${n} personne${n > 1 ? 's' : ''}`, groupe: 'Services', cible: { type: 'service', nom: s }, texte: s })
    }
    for (const p of parametres) {
      r.push({ cle: `r-${p.cle}`, titre: p.libelle, detail: `Réglage · ${p.categorie}`, groupe: 'Réglages', cible: { type: 'parametre', cle: p.cle }, texte: `${p.libelle} ${p.categorie}` })
    }
    return r
  }, [onglets, personnes, parametres, voitTout, profil])

  const resultats = useMemo(() => {
    const termes = sansAccent(q.trim()).split(/\s+/).filter(Boolean)
    if (!termes.length) return tous.filter((r) => r.groupe === 'Écrans')
    return tous.filter((r) => termes.every((t) => sansAccent(r.texte).includes(t))).slice(0, 40)
  }, [q, tous])
  useEffect(() => { setActif(0) }, [q])

  const choisir = (r: Resultat | undefined) => { if (r) { onChoisir(r.cible); onFermer() } }
  const clavier = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif((i) => Math.min(i + 1, resultats.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActif((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); choisir(resultats[actif]) }
  }
  useEffect(() => { document.getElementById(`res-${actif}`)?.scrollIntoView({ block: 'nearest' }) }, [actif])

  let groupe = ''
  return (
    <div className="voile recherche-voile" role="dialog" aria-modal="true" aria-label="Rechercher" onClick={onFermer}>
      <div className="fenetre recherche-fenetre" ref={ref} onClick={(e) => e.stopPropagation()}>
        <input ref={champ} id="recherche-globale" className="recherche-champ" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={clavier}
               placeholder={admin ? 'Personne, service, écran, réglage…' : 'Personne, service, écran…'} aria-label="Rechercher"
               role="combobox" aria-expanded="true" aria-controls="resultats-recherche" aria-activedescendant={resultats.length ? `res-${actif}` : undefined} />
        <ul id="resultats-recherche" className="resultats" role="listbox" aria-label="Résultats">
          {resultats.length === 0 && <li className="vide">Aucun résultat pour « {q} »</li>}
          {resultats.map((r, i) => {
            const titreGroupe = r.groupe !== groupe ? (groupe = r.groupe) : null
            return (
              <li key={r.cle} role="presentation">
                {titreGroupe && <div className="groupe-titre">{titreGroupe}</div>}
                <button id={`res-${i}`} role="option" aria-selected={i === actif} className="resultat" onMouseEnter={() => setActif(i)} onClick={() => choisir(r)}>
                  <strong>{r.titre}</strong><span className="doux petit">{r.detail}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="doux petit aide-recherche">↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer · Ctrl + K pour rouvrir</p>
      </div>
    </div>
  )
}
