import { useEffect, useMemo, useState } from 'react'
import type { Api, Presence, Profil } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { heure } from '../lib/temps'

type Etat = 'present' | 'tt' | 'absent' | 'parti' | 'non_pointe' | 'non_prevu'
const ETATS: Record<Etat, string> = {
  present: 'Présents', tt: 'Télétravail', absent: 'Absents', parti: 'Partis', non_pointe: 'Pas encore pointé', non_prevu: 'Pas prévus',
}
const ORDRE: Etat[] = ['non_pointe', 'present', 'tt', 'absent', 'parti', 'non_prevu']

function etatDe(statut: string): Etat {
  if (statut === 'Télétravail') return 'tt'
  if (statut === 'Parti') return 'parti'
  if (statut === 'Pas encore pointé') return 'non_pointe'
  if (statut.startsWith('Pas prévu')) return 'non_prevu'
  if (statut === 'Présent' || statut.startsWith('En ') || statut === 'Mandat' || statut === 'Permanence VAD') return 'present'
  return 'absent' // « Absent » ou motif visible par le N+1
}
const classeStatut = (s: string) => ({ present: 'present', tt: 'tt', absent: 'absent', parti: 'parti', non_pointe: '', non_prevu: '' })[etatDe(s)]

const compter = (l: Presence[]) => l.reduce((c, p) => { c[etatDe(p.statut)]++; return c },
  { present: 0, tt: 0, absent: 0, parti: 0, non_pointe: 0, non_prevu: 0 } as Record<Etat, number>)

export default function Equipe({ api, profil, compact = false, onVoirTout, onOuvrirFiche }: {
  api: Api; profil: Profil; compact?: boolean; onVoirTout?: () => void; onOuvrirFiche?: (personneId: string) => void
}) {
  const [liste, setListe] = useState<Presence[] | null>(null)
  const [filtre, setFiltre] = useState<Etat | null>(null)
  const [recherche, setRecherche] = useState('')
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null)
  const peutRappelerTous = ['rh', 'admin_rh', 'admin', 'direction'].includes(profil.role)
  const peutRappeler = (p: Presence) => peutRappelerTous || (profil.est_chef_service && p.mon_service)
  // Fiche de temps : N+1 (son service), RH, admin, direction — le serveur revérifie les droits
  const peutVoirFiche = (p: Presence) => !!onOuvrirFiche && (peutRappelerTous || (profil.est_chef_service && p.mon_service))

  useEffect(() => {
    const charger = () => api.presence().then(setListe).catch(() => setListe([]))
    charger()
    const t = setInterval(charger, 120_000)
    return () => clearInterval(t)
  }, [api])
  useEffect(() => { if (message) { const t = setTimeout(() => setMessage(null), 3500); return () => clearTimeout(t) } }, [message])

  const services = useMemo(() => {
    const m = new Map<string, Presence[]>()
    for (const p of liste ?? []) m.set(p.service, [...(m.get(p.service) ?? []), p])
    return [...m].map(([nom, membres]) => ({ nom, membres, mien: membres.some((x) => x.mon_service), compte: compter(membres) }))
      .sort((a, b) => Number(b.mien) - Number(a.mien) || a.nom.localeCompare(b.nom))
  }, [liste])

  async function rappeler(ids: string[]) {
    try {
      const n = await api.envoyerRappel(ids)
      setMessage({ texte: n ? `Rappel envoyé à ${n} personne(s) ✅` : 'Déjà rappelé récemment' })
    } catch (e) { setMessage({ texte: messageErreur(e), erreur: true }) }
  }

  if (!liste) return <section className="carte"><h2>Équipe du jour</h2><p className="vide">Chargement…</p></section>

  // Vue compacte (colonne de l'écran Pointer) : mon service seulement
  if (compact) {
    const mien = services.find((s) => s.mien)
    return (
      <section className="carte">
        <div className="ligne entre"><h2>Mon équipe aujourd’hui</h2>
          {mien && <span className="doux petit">{mien.compte.present + mien.compte.tt}/{mien.membres.length} au travail</span>}</div>
        {mien && <Compteurs compte={mien.compte} />}
        <div className="grille-personnes compacte" tabIndex={0} role="region" aria-label="Personnes de mon service">{mien?.membres.map((p) => <Tuile key={p.personne_id} p={p} />)}</div>
        {onVoirTout && <button className="lien petit" onClick={onVoirTout}>Voir tous les services →</button>}
      </section>
    )
  }

  const total = compter(liste)
  const q = recherche.trim().toLowerCase()
  const filtrer = (l: Presence[]) => l.filter((p) => (!filtre || etatDe(p.statut) === filtre) && (!q || `${p.prenom} ${p.nom}`.toLowerCase().includes(q)))
  const estOuvert = (nom: string, mien: boolean) => (q || filtre ? true : ouverts.has(nom) !== mien)   // mon service ouvert par défaut

  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <section className="carte">
          <div className="ligne entre barre-outils">
            <h2>Équipe du jour <span className="doux petit">· {liste.length} personnes</span></h2>
            <input id="recherche-equipe" className="recherche" placeholder="Rechercher une personne…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          </div>
          <div className="filtres" role="group" aria-label="Filtrer par statut">
            <button className="puce" aria-pressed={filtre === null} onClick={() => setFiltre(null)}>Tous <b>{liste.length}</b></button>
            {ORDRE.filter((e) => total[e] > 0).map((e) => (
              <button key={e} className="puce" aria-pressed={filtre === e} onClick={() => setFiltre(filtre === e ? null : e)}>
                <span className={`point ${e === 'non_pointe' || e === 'non_prevu' ? '' : e}`} />{ETATS[e]} <b>{total[e]}</b></button>
            ))}
          </div>
        </section>

        {services.map(({ nom, membres, mien, compte }) => {
          const visibles = filtrer(membres)
          if ((q || filtre) && visibles.length === 0) return null
          const ouvert = estOuvert(nom, mien)
          const nonPointes = membres.filter((p) => etatDe(p.statut) === 'non_pointe' && peutRappeler(p))
          return (
            <section key={nom} className={`carte service ${mien ? 'mien' : ''}`}>
              <div className="entete-service">
                <button className="bascule" aria-expanded={ouvert} onClick={() => setOuverts((s) => { const n = new Set(s); if (n.has(nom)) n.delete(nom); else n.add(nom); return n })}>
                  <span className="chevron" aria-hidden="true">{ouvert ? '▾' : '▸'}</span>
                  <span className="nom-service">{nom}{mien && <span className="pilule ok">Mon service</span>}</span>
                  <span className="doux petit">{compte.present + compte.tt}/{membres.length} au travail</span>
                </button>
                <Compteurs compte={compte} />
                {nonPointes.length > 0 && (
                  <button className="bouton secondaire petit" onClick={() => rappeler(nonPointes.map((p) => p.personne_id))}>
                    {nonPointes.length > 1 ? `Rappeler les ${nonPointes.length} non pointés` : 'Rappeler le non pointé'}</button>
                )}
              </div>
              {ouvert && (
                <div className="grille-personnes">
                  {visibles.sort((a, b) => ORDRE.indexOf(etatDe(a.statut)) - ORDRE.indexOf(etatDe(b.statut)) || a.nom.localeCompare(b.nom))
                    .map((p) => <Tuile key={p.personne_id} p={p} onRappeler={etatDe(p.statut) === 'non_pointe' && peutRappeler(p) ? () => rappeler([p.personne_id]) : undefined}
                                       onFiche={peutVoirFiche(p) ? () => onOuvrirFiche!(p.personne_id) : undefined} />)}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {message && <div className={`toast ${message.erreur ? 'erreur' : ''}`} role="status">{message.texte}</div>}
    </main>
  )
}

function Compteurs({ compte }: { compte: Record<Etat, number> }) {
  return (
    <div className="mini-compteurs" aria-label="Répartition">
      {(['present', 'tt', 'absent', 'non_pointe'] as Etat[]).filter((e) => compte[e] > 0).map((e) => (
        <span key={e} title={ETATS[e]}><span className={`point ${e === 'non_pointe' ? '' : e}`} />{compte[e]}</span>
      ))}
    </div>
  )
}

function Tuile({ p, onRappeler, onFiche }: { p: Presence; onRappeler?: () => void; onFiche?: () => void }) {
  const e = etatDe(p.statut)
  return (
    <div className={`tuile-personne etat-${e}`}>
      <span className="initiales">{(p.prenom[0] + p.nom[0]).toUpperCase()}</span>
      <span className="texte">
        {onFiche ? <button className="nom lien-nom" title="Voir sa fiche de temps" onClick={onFiche}>{p.prenom} {p.nom}</button>
                 : <span className="nom">{p.prenom} {p.nom}</span>}
        <span className="etat"><span className={`point ${classeStatut(p.statut)}`} />{p.statut}{p.depuis && e !== 'parti' ? ` · ${heure(p.depuis)}` : ''}</span>
      </span>
      {onRappeler && <button className="lien petit" onClick={onRappeler}>Rappeler</button>}
    </div>
  )
}
