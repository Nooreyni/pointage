import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AdminPersonne, Api, ComptesService, LigneAdoption } from '../lib/types'
import { telecharger, type Format } from '../lib/export'
import Export from '../components/Export'
import { Pagination, usePagination } from '../components/Pagination'
import FichesConnexion, { type FicheConnexion } from '../components/FichesConnexion'
import { IcCheck } from '../components/Icones'

type Message = { texte: string; erreur?: boolean }
type Filtre = 'tous' | 'jamais' | 'sans_pointage' | 'sans_notif'
const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** « aujourd'hui 08:12 », « hier », « il y a 5 j », « jamais » */
export function ilYaQuand(iso: string | null): string {
  if (!iso) return 'jamais'
  const d = new Date(iso), j = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const auj = new Date().toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) === d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })
  if (auj) return `aujourd’hui ${d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}`
  return j <= 1 ? 'hier' : `il y a ${j} j`
}
const sansPointage = (l: LigneAdoption) => !!l.derniere_connexion && l.pointages_7j === 0

/**
 * Lancement (pilote puis généralisation) : qui utilise vraiment l'outil, qui relancer, et création des comptes
 * d'un service en une fois avec des fiches de connexion à imprimer. RH, admin RH, direction, admin.
 */
export default function Lancement({ api, personnes, erreur, setMessage, onComptes }: {
  api: Api; personnes: AdminPersonne[]; erreur: (e: unknown) => void; setMessage: (m: Message) => void; onComptes: () => void
}) {
  const [lignes, setLignes] = useState<LigneAdoption[] | null>(null)
  const [services, setServices] = useState<ComptesService[]>([])
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [q, setQ] = useState('')
  const [choix, setChoix] = useState<Set<string>>(new Set())
  const [fiches, setFiches] = useState<FicheConnexion[] | null>(null)
  const [microsoft, setMicrosoft] = useState(false)
  const [enCours, setEnCours] = useState<{ fait: number; total: number } | null>(null)

  const charger = useCallback(() => {
    Promise.all([api.suiviAdoption(), api.sansCompteParService()]).then(([l, s]) => { setLignes(l); setServices(s) }).catch(erreur)
  }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  useEffect(() => { api.connexion().then((c) => setMicrosoft(c.microsoft)).catch(() => {}) }, [api])

  const l = lignes ?? []
  const nb = {
    tous: l.length, jamais: l.filter((x) => !x.derniere_connexion).length, sans_pointage: l.filter(sansPointage).length,
    sans_notif: l.filter((x) => x.appareils === 0).length,
  }
  const importees = services.reduce((t, s) => t + s.sans_compte + s.avec_compte, 0)
  const visibles = useMemo(() => l.filter((x) =>
    (filtre === 'tous' || (filtre === 'jamais' && !x.derniere_connexion) || (filtre === 'sans_pointage' && sansPointage(x)) || (filtre === 'sans_notif' && x.appareils === 0))
    && (!q || sansAccent(`${x.prenom} ${x.nom} ${x.service}`).includes(sansAccent(q)))), [l, filtre, q])
  const pager = usePagination(visibles, 25, `${filtre}|${q}`)
  const choisis = visibles.filter((x) => choix.has(x.personne_id))
  const basculer = (id: string) => setChoix((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toutCocher = () => setChoix((c) => (visibles.every((x) => c.has(x.personne_id)) ? new Set() : new Set(visibles.map((x) => x.personne_id))))

  // Génère un mot de passe pour chaque personne (création du compte si besoin), une à la fois, puis ouvre les fiches
  async function preparerFiches(cibles: { id: string; service: string }[], nouveaux: boolean) {
    if (!cibles.length) return
    const res: FicheConnexion[] = []; let echecs = 0
    setEnCours({ fait: 0, total: cibles.length })
    for (const [i, c] of cibles.entries()) {
      try { res.push({ ...(await api.genererMotDePasse(c.id)), service: c.service }) } catch (e) { echecs++; if (echecs === 1) erreur(e) }
      setEnCours({ fait: i + 1, total: cibles.length })
    }
    setEnCours(null); setChoix(new Set())
    if (res.length) setFiches(res)
    setMessage({ texte: `${res.length} ${nouveaux ? 'compte(s) créé(s)' : 'nouveau(x) mot(s) de passe'}${echecs ? ` · ${echecs} échec(s)` : ''}`, erreur: echecs > 0 && !res.length })
    charger(); if (nouveaux) onComptes()
  }

  async function relancer() {
    const ids = choisis.filter((x) => x.derniere_connexion).map((x) => x.personne_id)
    if (!ids.length) return setMessage({ texte: 'Ces personnes ne se sont jamais connectées : imprime-leur plutôt une fiche de connexion', erreur: true })
    const texte = filtre === 'sans_notif'
      ? 'Active les notifications sur ton téléphone (onglet Alertes) pour recevoir les rappels de pointage.'
      : 'Pense à pointer ton arrivée et ton départ dans CFB Pointage. Une question ? Le bouton ? en haut de l’écran.'
    try { const n = await api.envoyerRappel(ids, texte); setMessage({ texte: `Rappel envoyé à ${n} personne(s)` }); setChoix(new Set()) } catch (e) { erreur(e) }
  }

  function exporter(format: Format) {
    telecharger([['Nom', 'Prénom', 'Service', 'Compte créé le', 'Dernière connexion', 'Visite guidée', 'Notifications (appareils)', 'Dernier pointage', 'Pointages 7 j', 'Avis'],
      ...visibles.map((x) => [x.nom, x.prenom, x.service, x.compte_cree_le?.slice(0, 10) ?? '', x.derniere_connexion?.slice(0, 16).replace('T', ' ') ?? 'jamais',
        x.accueil_fait_le ? 'oui' : 'non', x.appareils, x.dernier_pointage?.slice(0, 16).replace('T', ' ') ?? '', x.pointages_7j, x.avis])],
      `lancement-${new Date().toISOString().slice(0, 10)}`, format, 'Suivi du lancement')
  }

  const pct = (n: number) => (l.length ? ` · ${Math.round((n / l.length) * 100)} %` : '')
  return (
    <>
      <div className="tuiles col-pleine tuiles-lancement">
        <div className="tuile"><strong>{l.length}</strong><span>comptes actifs sur {importees} personnes importées</span></div>
        <div className="tuile"><strong>{l.length - nb.jamais}</strong><span>se sont connectées{pct(l.length - nb.jamais)}</span></div>
        <div className="tuile"><strong>{l.filter((x) => x.pointages_7j > 0).length}</strong><span>ont pointé ces 7 derniers jours</span></div>
        <div className={`tuile ${nb.sans_notif > 0 ? 'alerte' : ''}`}><strong>{l.length - nb.sans_notif}</strong><span>reçoivent les notifications</span></div>
        <div className="tuile"><strong>{l.filter((x) => x.accueil_fait_le).length}</strong><span>ont fait la visite guidée</span></div>
      </div>

      <section className="carte col-pleine">
        <div className="ligne entre barre-outils">
          <h2>Qui relancer ?</h2>
          <span className="ligne">
            <input id="recherche-lancement" type="search" className="recherche" placeholder="Chercher…" aria-label="Chercher une personne" value={q} onChange={(e) => setQ(e.target.value)} />
            <Export disabled={!visibles.length} onExporter={exporter} />
          </span>
        </div>
        <div className="puces filtres" role="group" aria-label="Filtrer" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
          {([['tous', 'Tous'], ['jamais', 'Jamais connectés'], ['sans_pointage', 'Connectés, sans pointage (7 j)'], ['sans_notif', 'Sans notifications']] as [Filtre, string][]).map(([f, t]) => (
            <button key={f} type="button" className="puce" aria-pressed={filtre === f} onClick={() => { setFiltre(f); setChoix(new Set()) }}>{t} <span className="doux">{nb[f]}</span></button>
          ))}
        </div>
        {lignes === null ? <div className="squelette">Chargement…</div> : !visibles.length ? <p className="vide">Personne dans cette liste{filtre !== 'tous' ? ' : bravo !' : '.'}</p> : (
          <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
            <table className="tableau">
              <thead><tr>
                <th className="col-case"><input type="checkbox" aria-label="Tout cocher" checked={visibles.length > 0 && visibles.every((x) => choix.has(x.personne_id))} onChange={toutCocher} /></th>
                <th>Personne</th><th>Connexion</th><th className="masque-mobile">Dernier pointage</th><th>Notifications</th><th className="masque-mobile">Visite</th>
              </tr></thead>
              <tbody>
                {pager.items.map((x) => (
                  <tr key={x.personne_id}>
                    <td className="col-case"><input type="checkbox" aria-label={`Choisir ${x.prenom} ${x.nom}`} checked={choix.has(x.personne_id)} onChange={() => basculer(x.personne_id)} /></td>
                    <td><strong>{x.nom} {x.prenom}</strong><br /><span className="doux petit">{x.service}</span></td>
                    <td className={x.derniere_connexion ? '' : 'attention'}>{ilYaQuand(x.derniere_connexion)}</td>
                    <td className="masque-mobile">{x.dernier_pointage ? ilYaQuand(x.dernier_pointage) : '—'}</td>
                    <td>{x.appareils > 0 ? <span className="pilule ok">Oui</span> : <span className="pilule neutre">Non</span>}</td>
                    <td className="masque-mobile">{x.accueil_fait_le ? <IcCheck size={16} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pager={pager} quoi="personnes" />
        <div className="ligne actions-selection">
          <span className="doux petit espace">{choisis.length ? `${choisis.length} choisie(s)` : 'Coche des personnes pour les relancer ou leur refaire une fiche.'}</span>
          <button type="button" className="bouton secondaire petit" disabled={!choisis.length || !!enCours} onClick={relancer}>Envoyer un rappel</button>
          <button type="button" className="bouton petit" disabled={!choisis.length || !!enCours}
                  onClick={() => preparerFiches(choisis.map((x) => ({ id: x.personne_id, service: x.service })), false)}>Nouveau mot de passe + fiche</button>
        </div>
        {choisis.length > 0 && <p className="doux petit" style={{ margin: 0 }}>« Nouveau mot de passe » remplace l’ancien : à utiliser pour un oubli ou une fiche perdue.</p>}
      </section>

      <CreerComptes services={services} personnes={personnes} enCours={enCours} onCreer={(c) => preparerFiches(c, true)} />

      {fiches && <FichesConnexion fiches={fiches} microsoft={microsoft} onFermer={() => setFiches(null)} />}
    </>
  )
}

/** Créer les comptes d'un service en une fois : choisir le service, décocher les absents, créer, imprimer. */
function CreerComptes({ services, personnes, enCours, onCreer }: {
  services: ComptesService[]; personnes: AdminPersonne[]; enCours: { fait: number; total: number } | null
  onCreer: (cibles: { id: string; service: string }[]) => void
}) {
  const [service, setService] = useState<string | null>(null)
  const [exclus, setExclus] = useState<Set<string>>(new Set())
  const aCreer = services.filter((s) => s.sans_compte > 0)
  const sansCompte = personnes.filter((p) => !p.compte_lie && !p.date_sortie && (service === 'tous' || p.service_id === service))
    .sort((a, b) => a.service.localeCompare(b.service) || a.nom.localeCompare(b.nom))
  const retenus = sansCompte.filter((p) => !exclus.has(p.id))
  const total = aCreer.reduce((t, s) => t + s.sans_compte, 0)

  return (
    <section className="carte col-pleine">
      <h2>Créer des comptes {total > 0 && <span className="pilule attente">{total} personne(s) sans compte</span>}</h2>
      <p className="doux petit" style={{ margin: 0 }}>Choisis un service : chaque personne reçoit un compte et un mot de passe provisoire, sur une fiche à imprimer (4 par page) avec un QR code.
        Les personnes apparaissent dans l’outil dès que leur compte existe.</p>
      {!aCreer.length ? <p className="positif petit"><IcCheck size={14} /> Tout le monde a un compte.</p> : (
        <div className="puces" role="group" aria-label="Service" style={{ justifyContent: 'flex-start' }}>
          {aCreer.map((s) => (
            <button key={s.service_id} type="button" className="puce" aria-pressed={service === s.service_id} onClick={() => { setService(s.service_id); setExclus(new Set()) }}>
              {s.service} <span className="doux">{s.sans_compte}</span></button>
          ))}
          {aCreer.length > 1 && <button type="button" className="puce" aria-pressed={service === 'tous'} onClick={() => { setService('tous'); setExclus(new Set()) }}>Tous <span className="doux">{total}</span></button>}
        </div>
      )}
      {service && sansCompte.length > 0 && <>
        <ul className="liste-cases">
          {sansCompte.map((p) => (
            <li key={p.id}><label className="case-a-cocher">
              <input type="checkbox" checked={!exclus.has(p.id)} onChange={() => setExclus((x) => { const n = new Set(x); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })} />
              <span>{p.nom} {p.prenom} <span className="doux petit">· {p.email}{service === 'tous' ? ` · ${p.service}` : ''}</span></span>
            </label></li>
          ))}
        </ul>
        <div className="ligne">
          <span className="espace doux petit">{enCours ? `Création… ${enCours.fait} / ${enCours.total}` : 'Décoche les personnes absentes ou qui ne pointent pas.'}</span>
          <button type="button" className="bouton" disabled={!retenus.length || !!enCours}
                  onClick={() => onCreer(retenus.map((p) => ({ id: p.id, service: p.service })))}>
            {enCours ? 'Création…' : `Créer ${retenus.length} compte${retenus.length > 1 ? 's' : ''} et préparer les fiches`}</button>
        </div>
      </>}
    </section>
  )
}

