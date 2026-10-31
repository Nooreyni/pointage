import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Acces, AdminPersonne, AdminService, Api, Ferie, Parametre, Profil, Regime, Reseau, Role, SaisiePersonne } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, duree, hhmm, jourBxl } from '../lib/temps'

type Section = 'personnes' | 'services' | 'regimes' | 'acces' | 'parametres' | 'reseau'
type Message = { texte: string; erreur?: boolean }

export const ROLES: Record<Role, string> = {
  employe: 'Employé', rh: 'RH', admin_rh: 'Admin RH', responsable_isp: 'Responsable ISP', direction: 'Direction', admin: 'Admin général',
}
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const enMin = (v: string) => { const [h, m] = (v || '0:0').split(':').map(Number); return h * 60 + (m || 0) }

export default function Admin({ api, profil }: { api: Api; profil: Profil }) {
  const estAdmin = profil.role === 'admin'
  const [section, setSection] = useState<Section>('personnes')
  const [personnes, setPersonnes] = useState<AdminPersonne[] | null>(null)
  const [services, setServices] = useState<AdminService[]>([])
  const [regimes, setRegimes] = useState<Regime[]>([])
  const [message, setMessage] = useState<Message | null>(null)

  const erreur = useCallback((e: unknown) => setMessage({ texte: messageErreur(e), erreur: true }), [])
  const charger = useCallback(async () => {
    try {
      const [p, s, r] = await Promise.all([api.adminPersonnes(), api.adminServices(), api.regimes()])
      setPersonnes(p); setServices(s); setRegimes(r)
    } catch (e) { erreur(e) }
  }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), message.erreur ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [message])

  const ok = async (texte: string) => { setMessage({ texte }); await charger() }
  const sections: [Section, string][] = [
    ['personnes', 'Personnes'], ['services', 'Services'], ['regimes', 'Régimes'], ['acces', 'Accès'], ['parametres', 'Paramètres'],
    ['reseau', estAdmin ? 'Réseau & fériés' : 'Jours fériés'],
  ]

  return (
    <main className="contenu">
      <div className="col-pleine pile">
        <div className="segments defilant" role="tablist" aria-label="Administration">
          {sections.map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{l}</button>)}
        </div>
        {section === 'personnes' && <Personnes personnes={personnes} services={services} regimes={regimes} estAdmin={estAdmin} api={api} ok={ok} erreur={erreur} />}
        {section === 'services' && <Services services={services} personnes={personnes ?? []} api={api} ok={ok} erreur={erreur} />}
        {section === 'regimes' && <Regimes regimes={regimes} api={api} ok={ok} erreur={erreur} />}
        {section === 'acces' && <AccesServices api={api} personnes={personnes ?? []} services={services} erreur={erreur} setMessage={setMessage} />}
        {section === 'parametres' && <Parametres api={api} erreur={erreur} setMessage={setMessage} />}
        {section === 'reseau' && <ReseauFeries api={api} estAdmin={estAdmin} erreur={erreur} setMessage={setMessage} />}
      </div>
      {message && <div className={`toast ${message.erreur ? 'erreur' : ''}`} role="status">{message.texte}</div>}
    </main>
  )
}

type Commun = { api: Api; ok: (t: string) => Promise<void>; erreur: (e: unknown) => void }

function Fenetre({ titre, onFermer, children }: { titre: string; onFermer: () => void; children: React.ReactNode }) {
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <div className="fenetre" onClick={(e) => e.stopPropagation()}><h2>{titre}</h2>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Personnes({ personnes, services, regimes, estAdmin, api, ok, erreur }: Commun & {
  personnes: AdminPersonne[] | null; services: AdminService[]; regimes: Regime[]; estAdmin: boolean
}) {
  const [filtre, setFiltre] = useState('')
  const [sortis, setSortis] = useState(false)
  const [fiche, setFiche] = useState<AdminPersonne | 'nouvelle' | null>(null)
  const auj = jourBxl()
  const liste = (personnes ?? []).filter((p) => (sortis || !p.date_sortie || p.date_sortie >= auj)
    && `${p.prenom} ${p.nom} ${p.email} ${p.service} ${ROLES[p.role]}`.toLowerCase().includes(filtre.toLowerCase()))

  return (
    <section className="carte">
      <div className="ligne entre barre-outils">
        <h2>Personnes <span className="doux petit">({liste.length})</span></h2>
        <span className="ligne">
          <input id="filtre-personnes" className="recherche" placeholder="Rechercher…" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
          <button className="bouton petit" onClick={() => setFiche('nouvelle')}>Nouvelle personne</button>
        </span>
      </div>
      <label className="ligne petit doux" style={{ margin: '8px 0' }}>
        <input type="checkbox" id="voir-sortis" checked={sortis} onChange={(e) => setSortis(e.target.checked)} /> Afficher les personnes parties
      </label>
      {!personnes && <p className="vide">Chargement…</p>}
      <div className="tableau-defilant">
        <table className="tableau cliquable">
          <thead><tr><th>Nom</th><th>Service</th><th>Rôle</th><th className="masque-mobile">Régime</th><th className="masque-mobile">Compte</th></tr></thead>
          <tbody>{liste.map((p) => (
            <tr key={p.id} onClick={() => setFiche(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setFiche(p)}>
              <td><strong>{p.nom} {p.prenom}</strong>{p.type === 'isp' && <span className="pilule neutre" style={{ marginLeft: 6 }}>ISP</span>}
                <div className="doux petit">{p.email}</div></td>
              <td>{p.service}</td>
              <td>{p.role === 'employe' ? <span className="doux">{ROLES[p.role]}</span> : <strong>{ROLES[p.role]}</strong>}</td>
              <td className="doux masque-mobile">{p.regime ?? '—'}</td>
              <td className="masque-mobile">{p.date_sortie && p.date_sortie < auj ? <span className="pilule neutre">Parti le {dateCourte(p.date_sortie)}</span>
                : p.compte_lie ? <span className="pilule ok">Connecté</span> : <span className="pilule attente">Jamais connecté</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {fiche && <FichePersonne personne={fiche === 'nouvelle' ? null : fiche} services={services} regimes={regimes} estAdmin={estAdmin}
                               api={api} onFermer={() => setFiche(null)} ok={async (t) => { setFiche(null); await ok(t) }} erreur={erreur} />}
    </section>
  )
}

function FichePersonne({ personne, services, regimes, estAdmin, api, onFermer, ok, erreur }: Commun & {
  personne: AdminPersonne | null; services: AdminService[]; regimes: Regime[]; estAdmin: boolean; onFermer: () => void
}) {
  const [f, setF] = useState<SaisiePersonne>(() => personne
    ? { id: personne.id, prenom: personne.prenom, nom: personne.nom, email: personne.email, service_id: personne.service_id, role: personne.role,
        type: personne.type, partenaire_isp: personne.partenaire_isp, matricule: personne.matricule, date_entree: personne.date_entree,
        date_sortie: personne.date_sortie, regime_id: personne.regime_id }
    : { id: null, prenom: '', nom: '', email: '', service_id: services[0]?.id ?? '', role: 'employe', type: 'interne', partenaire_isp: null,
        matricule: null, date_entree: jourBxl(), date_sortie: null, regime_id: regimes.find((r) => r.actif)?.id ?? null })
  const [nouveauRegime, setNouveauRegime] = useState<number>(personne?.regime_id ?? regimes[0]?.id ?? 0)
  const [dateRegime, setDateRegime] = useState(`${Number(jourBxl().slice(0, 4)) + 1}-01-01`)
  const [enCours, setEnCours] = useState(false)
  const maj = <K extends keyof SaisiePersonne>(k: K, v: SaisiePersonne[K]) => setF((x) => ({ ...x, [k]: v }))
  const verrouille = personne?.role === 'admin' && !estAdmin

  return (
    <Fenetre titre={personne ? `${personne.prenom} ${personne.nom}` : 'Nouvelle personne'} onFermer={onFermer}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setEnCours(true)
        try { await api.enregistrerPersonne(f); await ok(personne ? 'Fiche mise à jour ✅' : 'Personne créée ✅ — elle pourra se connecter avec son compte Microsoft') }
        catch (err) { erreur(err) } finally { setEnCours(false) }
      }}>
        {verrouille && <p className="attention petit">Seul un admin général peut modifier un admin général.</p>}
        <fieldset disabled={verrouille} className="sans-cadre">
          <div className="champs-ligne">
            <label className="champ">Prénom<input id="p-prenom" value={f.prenom} required onChange={(e) => maj('prenom', e.target.value)} /></label>
            <label className="champ">Nom<input id="p-nom" value={f.nom} required onChange={(e) => maj('nom', e.target.value)} /></label>
          </div>
          <label className="champ">E-mail Microsoft du CFB
            <input id="p-email" type="email" value={f.email} required onChange={(e) => maj('email', e.target.value)} placeholder="prenom.nom@…" /></label>
          <div className="champs-ligne">
            <label className="champ">Service
              <select id="p-service" value={f.service_id} onChange={(e) => maj('service_id', e.target.value)}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</select></label>
            <label className="champ">Rôle
              <select id="p-role" value={f.role} onChange={(e) => maj('role', e.target.value as Role)}>
                {(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r} disabled={r === 'admin' && !estAdmin}>{ROLES[r]}</option>)}</select></label>
          </div>
          <div className="champs-ligne">
            <label className="champ">Contrat
              <select id="p-type" value={f.type} onChange={(e) => maj('type', e.target.value as 'interne' | 'isp')}>
                <option value="interne">Personnel CFB</option><option value="isp">ISP (article 60, CPAS)</option></select></label>
            {f.type === 'isp'
              ? <label className="champ">Partenaire<input id="p-partenaire" value={f.partenaire_isp ?? ''} required placeholder="CPAS de …"
                                                         onChange={(e) => maj('partenaire_isp', e.target.value)} /></label>
              : <label className="champ">Matricule Partena<input id="p-matricule" value={f.matricule ?? ''} onChange={(e) => maj('matricule', e.target.value)} /></label>}
          </div>
          <div className="champs-ligne">
            <label className="champ">Date d’entrée<input id="p-entree" type="date" value={f.date_entree} required onChange={(e) => maj('date_entree', e.target.value)} /></label>
            <label className="champ">Date de départ<input id="p-sortie" type="date" value={f.date_sortie ?? ''} min={f.date_entree}
                                                          onChange={(e) => maj('date_sortie', e.target.value || null)} /></label>
          </div>
          {!personne && (
            <label className="champ">Régime de travail
              <select id="p-regime" value={f.regime_id ?? ''} required onChange={(e) => maj('regime_id', Number(e.target.value))}>
                {regimes.filter((r) => r.actif).map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}</select></label>
          )}
          <p className="doux petit">Chef de service : se règle dans l’onglet Services. Après le départ, la personne ne peut plus se connecter ; son historique est conservé.</p>
          <div className="actions">
            <button type="button" className="bouton secondaire" onClick={onFermer}>Fermer</button>
            <button className="bouton" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </fieldset>
      </form>

      {personne && !verrouille && (
        <div className="encart">
          <h3>Régime de travail</h3>
          <p className="petit">Actuel : <strong>{personne.regime ?? '—'}</strong>{personne.regime_depuis && ` depuis le ${dateCourte(personne.regime_depuis)}`}</p>
          <div className="champs-ligne">
            <label className="champ">Nouveau régime
              <select id="p-nouveau-regime" value={nouveauRegime} onChange={(e) => setNouveauRegime(Number(e.target.value))}>
                {regimes.filter((r) => r.actif).map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}</select></label>
            <label className="champ">À partir du<input id="p-date-regime" type="date" value={dateRegime} onChange={(e) => setDateRegime(e.target.value)} /></label>
          </div>
          <button className="bouton secondaire large" onClick={async () => {
            try { await api.changerRegime(personne.id, nouveauRegime, dateRegime); await ok('Changement de régime enregistré ✅') } catch (e) { erreur(e) }
          }}>Programmer le changement</button>
        </div>
      )}
    </Fenetre>
  )
}

// ---------------------------------------------------------------------------
function Services({ services, personnes, api, ok, erreur }: Commun & { services: AdminService[]; personnes: AdminPersonne[] }) {
  const [edition, setEdition] = useState<(Omit<AdminService, 'id'> & { id: string | null }) | null>(null)
  const nomDe = (id: string) => { const p = personnes.find((x) => x.id === id); return p ? `${p.prenom} ${p.nom}` : '?' }
  const nouveau = () => setEdition({ id: null, nom: '', parent_id: services.find((s) => !s.parent_id)?.id ?? null, couleur: '#2479BE',
                                     seuil_absence_pct: 50, actif: true, chefs: [], effectif: 0 })
  return (
    <section className="carte">
      <div className="ligne entre"><h2>Services</h2><button className="bouton petit" onClick={nouveau}>Nouveau service</button></div>
      <p className="doux petit">Un service sans chef remonte ses demandes au chef du service parent (la direction).</p>
      <div className="tableau-defilant">
        <table className="tableau cliquable">
          <thead><tr><th>Service</th><th>Rattaché à</th><th>Chef(s)</th><th className="num">Effectif</th><th className="num">Seuil d’absence</th></tr></thead>
          <tbody>{services.map((s) => (
            <tr key={s.id} onClick={() => setEdition(s)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdition(s)}>
              <td><span className="pastille-service" style={{ background: s.couleur ?? '#B7BFD3' }} /><strong>{s.nom}</strong>
                {!s.actif && <span className="pilule neutre" style={{ marginLeft: 6 }}>inactif</span>}</td>
              <td className="doux">{services.find((x) => x.id === s.parent_id)?.nom ?? '—'}</td>
              <td>{s.chefs.length ? s.chefs.map(nomDe).join(', ') : <span className="doux">aucun → direction</span>}</td>
              <td className="num">{s.effectif}</td>
              <td className="num">{s.seuil_absence_pct} %</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {edition && (
        <Fenetre titre={edition.id ? edition.nom : 'Nouveau service'} onFermer={() => setEdition(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault()
            try { await api.enregistrerService(edition); setEdition(null); await ok('Service enregistré ✅') } catch (err) { erreur(err) }
          }}>
            <label className="champ">Nom<input id="s-nom" value={edition.nom} required onChange={(e) => setEdition({ ...edition, nom: e.target.value })} /></label>
            <div className="champs-ligne">
              <label className="champ">Rattaché à
                <select id="s-parent" value={edition.parent_id ?? ''} onChange={(e) => setEdition({ ...edition, parent_id: e.target.value || null })}>
                  <option value="">— (sommet)</option>
                  {services.filter((s) => s.id !== edition.id).map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</select></label>
              <label className="champ">Seuil d’absence (%)
                <input id="s-seuil" type="number" min={0} max={100} value={edition.seuil_absence_pct}
                       onChange={(e) => setEdition({ ...edition, seuil_absence_pct: Number(e.target.value) })} /></label>
            </div>
            <div className="champ">Chef(s) de service
              <div className="liste-cases">
                {personnes.filter((p) => !p.date_sortie && (p.service_id === edition.id || edition.chefs.includes(p.id) || p.role === 'direction'))
                  .map((p) => (
                    <label key={p.id} className="ligne"><input type="checkbox" checked={edition.chefs.includes(p.id)}
                      onChange={(e) => setEdition({ ...edition, chefs: e.target.checked ? [...edition.chefs, p.id] : edition.chefs.filter((c) => c !== p.id) })} />
                      {p.prenom} {p.nom} <span className="doux petit">· {p.service}</span></label>
                  ))}
                {!edition.id && <span className="doux petit">Enregistre d’abord le service, puis rattache-y des personnes pour choisir le chef.</span>}
              </div>
            </div>
            <div className="champs-ligne">
              <label className="champ">Couleur<input id="s-couleur" type="color" value={edition.couleur ?? '#2479BE'} onChange={(e) => setEdition({ ...edition, couleur: e.target.value })} /></label>
              <label className="champ">État
                <select id="s-actif" value={edition.actif ? '1' : '0'} onChange={(e) => setEdition({ ...edition, actif: e.target.value === '1' })}>
                  <option value="1">Actif</option><option value="0">Inactif</option></select></label>
            </div>
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={() => setEdition(null)}>Fermer</button>
              <button className="bouton">Enregistrer</button>
            </div>
          </form>
        </Fenetre>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
function Regimes({ regimes, api, ok, erreur }: Commun & { regimes: Regime[] }) {
  const [edition, setEdition] = useState<{ id: number | null; libelle: string; contrat: Regime['contrat']; heures: string[]; actif: boolean; utilise: boolean } | null>(null)
  const ouvrir = (r: Regime | null) => setEdition(r
    ? { id: r.id, libelle: r.libelle, contrat: r.contrat, heures: r.minutes_jour.map(hhmm), actif: r.actif, utilise: r.utilisations > 0 }
    : { id: null, libelle: '', contrat: 'temps_partiel', heures: ['07:36', '07:36', '07:36', '07:36', '07:36', '00:00', '00:00'], actif: true, utilise: false })
  const total = edition ? edition.heures.reduce((t, h) => t + enMin(h), 0) : 0

  return (
    <section className="carte">
      <div className="ligne entre"><h2>Régimes de travail</h2><button className="bouton petit" onClick={() => ouvrir(null)}>Nouveau régime</button></div>
      <p className="doux petit">Heures prévues pour chaque jour de la semaine. Un régime déjà utilisé ne change pas d’horaire : on en crée un nouveau.</p>
      <div className="tableau-defilant">
        <table className="tableau cliquable">
          <thead><tr><th>Régime</th>{JOURS.map((j) => <th key={j} className="num">{j}</th>)}<th className="num">Semaine</th><th className="num">Personnes</th></tr></thead>
          <tbody>{regimes.map((r) => (
            <tr key={r.id} onClick={() => ouvrir(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && ouvrir(r)} className={r.actif ? '' : 'inactif'}>
              <td><strong>{r.libelle}</strong></td>
              {r.minutes_jour.map((m, i) => <td key={i} className="num doux">{m ? duree(m) : '—'}</td>)}
              <td className="num"><strong>{duree(r.minutes_semaine)}</strong></td>
              <td className="num">{r.utilisations}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {edition && (
        <Fenetre titre={edition.id ? edition.libelle : 'Nouveau régime'} onFermer={() => setEdition(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.enregistrerRegime({ id: edition.id, libelle: edition.libelle, contrat: edition.contrat, minutes_jour: edition.heures.map(enMin), actif: edition.actif })
              setEdition(null); await ok('Régime enregistré ✅')
            } catch (err) { erreur(err) }
          }}>
            <label className="champ">Nom<input id="r-libelle" value={edition.libelle} required placeholder="Ex. 4/5 (mercredi libre)"
                                               onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} /></label>
            <label className="champ">Contrat
              <select id="r-contrat" value={edition.contrat} onChange={(e) => setEdition({ ...edition, contrat: e.target.value as Regime['contrat'] })}>
                <option value="temps_plein">Temps plein</option><option value="temps_partiel">Temps partiel</option><option value="isp">ISP</option></select></label>
            {edition.utilise && <p className="attention petit">Utilisé par des personnes : les heures sont verrouillées.</p>}
            <div className="grille-jours">
              {JOURS.map((j, i) => (
                <label key={j} className="champ">{j}
                  <input id={`r-jour-${i}`} type="time" value={edition.heures[i]} disabled={edition.utilise}
                         onChange={(e) => setEdition({ ...edition, heures: edition.heures.map((h, k) => (k === i ? e.target.value || '00:00' : h)) })} /></label>
              ))}
            </div>
            <p className="petit">Total : <strong>{duree(total)}</strong> par semaine</p>
            <label className="ligne petit"><input type="checkbox" checked={edition.actif} onChange={(e) => setEdition({ ...edition, actif: e.target.checked })} />
              Proposé pour les nouvelles personnes</label>
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={() => setEdition(null)}>Fermer</button>
              <button className="bouton" disabled={total === 0}>Enregistrer</button>
            </div>
          </form>
        </Fenetre>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
function AccesServices({ api, personnes, services, erreur, setMessage }: {
  api: Api; personnes: AdminPersonne[]; services: AdminService[]; erreur: (e: unknown) => void; setMessage: (m: Message) => void
}) {
  const [liste, setListe] = useState<Acces[]>([])
  const [personne, setPersonne] = useState('')
  const [service, setService] = useState('')
  const [valider, setValider] = useState(false)
  const charger = useCallback(() => { api.acces().then(setListe).catch(erreur) }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  const candidats = useMemo(() => personnes.filter((p) => !p.date_sortie), [personnes])

  return (
    <section className="carte">
      <h2>Accès à d’autres services</h2>
      <p className="doux petit">Pour qu’un responsable voie (et éventuellement valide) les demandes d’un service qui n’est pas le sien.</p>
      <form className="champs-ligne aligne-bas" onSubmit={async (e) => {
        e.preventDefault()
        try { await api.donnerAcces(personne, service, valider); setMessage({ texte: 'Accès accordé ✅' }); charger() } catch (err) { erreur(err) }
      }}>
        <label className="champ">Personne<select id="a-personne" value={personne} required onChange={(e) => setPersonne(e.target.value)}>
          <option value="" disabled>Choisir…</option>{candidats.map((p) => <option key={p.id} value={p.id}>{p.nom} {p.prenom} — {p.service}</option>)}</select></label>
        <label className="champ">Service<select id="a-service" value={service} required onChange={(e) => setService(e.target.value)}>
          <option value="" disabled>Choisir…</option>{services.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</select></label>
        <label className="champ">Droit<select id="a-droit" value={valider ? '1' : '0'} onChange={(e) => setValider(e.target.value === '1')}>
          <option value="0">Lecture seule</option><option value="1">Lecture + validation</option></select></label>
        <button className="bouton" style={{ marginBottom: 14 }}>Accorder</button>
      </form>
      {liste.length === 0 ? <p className="vide">Aucun accès particulier.</p> : (
        <ul className="liste">{liste.map((a) => (
          <li key={a.personne_id + a.service_id}>
            <span style={{ flex: 1 }}><strong>{a.prenom} {a.nom}</strong> → {a.service}</span>
            <span className={`pilule ${a.peut_valider ? 'ok' : 'neutre'}`}>{a.peut_valider ? 'Lecture + validation' : 'Lecture'}</span>
            <button className="lien petit" onClick={async () => {
              try { await api.retirerAcces(a.personne_id, a.service_id); setMessage({ texte: 'Accès retiré' }); charger() } catch (e) { erreur(e) }
            }}>Retirer</button>
          </li>
        ))}</ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
function valeurLisible(p: Parametre): string {
  if (p.unite === 'min') return duree(p.valeur)
  if (p.unite === 'min_depuis_minuit') return hhmm(p.valeur)
  return `${p.valeur} ${p.unite}`
}

function Parametres({ api, erreur, setMessage }: { api: Api; erreur: (e: unknown) => void; setMessage: (m: Message) => void }) {
  const [liste, setListe] = useState<Parametre[]>([])
  const [edition, setEdition] = useState<{ p: Parametre; valeur: string; source: string } | null>(null)
  const charger = useCallback(() => { api.parametres().then(setListe).catch(erreur) }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  const provisoires = liste.filter((p) => p.provisoire).length

  return (
    <section className="carte">
      <div className="ligne entre"><h2>Règles de calcul</h2>{provisoires > 0 && <span className="pilule attente">{provisoires} à confirmer</span>}</div>
      <p className="doux petit">Valeurs provisoires à remplacer par celles du règlement de travail. Chaque modification exige sa source et est tracée.</p>
      <ul className="liste">{liste.map((p) => (
        <li key={p.cle}>
          <span style={{ flex: 1, minWidth: 0 }}>{p.libelle}<div className="doux petit">{p.source ?? '—'}</div></span>
          <strong className="num">{valeurLisible(p)}</strong>
          <span className={`pilule ${p.provisoire ? 'attente' : 'ok'}`}>{p.provisoire ? 'Provisoire' : 'Confirmé'}</span>
          <button className="lien petit" onClick={() => setEdition({ p, valeur: p.unite === 'min_depuis_minuit' ? hhmm(p.valeur) : String(p.valeur), source: '' })}>Modifier</button>
        </li>
      ))}</ul>
      {edition && (
        <Fenetre titre={edition.p.libelle} onFermer={() => setEdition(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault()
            const v = edition.p.unite === 'min_depuis_minuit' ? enMin(edition.valeur) : Number(edition.valeur)
            try { await api.modifierParametre(edition.p.cle, v, edition.source); setEdition(null); setMessage({ texte: 'Règle confirmée ✅' }); charger() }
            catch (err) { erreur(err) }
          }}>
            <label className="champ">Valeur ({edition.p.unite === 'min_depuis_minuit' ? 'heure' : edition.p.unite})
              <input id="param-valeur" type={edition.p.unite === 'min_depuis_minuit' ? 'time' : 'number'} value={edition.valeur} required
                     onChange={(e) => setEdition({ ...edition, valeur: e.target.value })} /></label>
            <label className="champ">Source (obligatoire)
              <input id="param-source" value={edition.source} required placeholder="Ex. règlement de travail, art. 12"
                     onChange={(e) => setEdition({ ...edition, source: e.target.value })} /></label>
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={() => setEdition(null)}>Fermer</button>
              <button className="bouton">Confirmer</button>
            </div>
          </form>
        </Fenetre>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
function ReseauFeries({ api, estAdmin, erreur, setMessage }: { api: Api; estAdmin: boolean; erreur: (e: unknown) => void; setMessage: (m: Message) => void }) {
  const [reseaux, setReseaux] = useState<Reseau[]>([])
  const [feries, setFeries] = useState<Ferie[]>([])
  const [plage, setPlage] = useState(''), [libelleReseau, setLibelleReseau] = useState('')
  const [jour, setJour] = useState(''), [libelleFerie, setLibelleFerie] = useState('')
  const charger = useCallback(() => {
    api.feries().then(setFeries).catch(erreur)
    if (estAdmin) api.reseaux().then(setReseaux).catch(erreur)
  }, [api, erreur, estAdmin])
  useEffect(() => { charger() }, [charger])
  const action = async (f: () => Promise<void>, texte: string) => { try { await f(); setMessage({ texte }); charger() } catch (e) { erreur(e) } }

  return (
    <div className="graphes">
      {estAdmin && (
        <section className="carte">
          <h2>Réseau du CFB</h2>
          <p className="doux petit">Un pointage fait depuis ces adresses compte comme « Bureau », ailleurs comme « Télétravail ».</p>
          <ul className="liste">{reseaux.map((r) => (
            <li key={r.plage}><code style={{ flex: 1 }}>{r.plage}</code><span className="doux">{r.libelle}</span>
              <button className="lien petit" onClick={() => action(() => api.enregistrerReseau(r.plage, r.libelle, true), 'Plage retirée')}>Retirer</button></li>
          ))}</ul>
          <form className="champs-ligne aligne-bas" onSubmit={(e) => { e.preventDefault(); action(() => api.enregistrerReseau(plage.trim(), libelleReseau), 'Plage ajoutée ✅') }}>
            <label className="champ">Plage IP<input id="reseau-plage" value={plage} required placeholder="203.0.113.0/24" onChange={(e) => setPlage(e.target.value)} /></label>
            <label className="champ">Lieu<input id="reseau-libelle" value={libelleReseau} required placeholder="Siège" onChange={(e) => setLibelleReseau(e.target.value)} /></label>
            <button className="bouton" style={{ marginBottom: 14 }}>Ajouter</button>
          </form>
        </section>
      )}
      <section className="carte">
        <h2>Jours fériés</h2>
        <ul className="liste compacte">{feries.map((f) => (
          <li key={f.jour}><span style={{ width: 110 }}>{dateCourte(f.jour)} {f.jour.slice(0, 4)}</span><span style={{ flex: 1 }}>{f.libelle}</span>
            {f.recuperable && <span className="pilule attente">week-end → à récupérer</span>}
            {f.jour > jourBxl() && <button className="lien petit" onClick={() => action(() => api.enregistrerFerie(f.jour, f.libelle, true), 'Jour férié retiré')}>Retirer</button>}</li>
        ))}</ul>
        <form className="champs-ligne aligne-bas" onSubmit={(e) => { e.preventDefault(); action(() => api.enregistrerFerie(jour, libelleFerie), 'Jour férié ajouté ✅') }}>
          <label className="champ">Date<input id="ferie-jour" type="date" value={jour} required onChange={(e) => setJour(e.target.value)} /></label>
          <label className="champ">Nom<input id="ferie-libelle" value={libelleFerie} required placeholder="Ex. Lundi de Pâques" onChange={(e) => setLibelleFerie(e.target.value)} /></label>
          <button className="bouton" style={{ marginBottom: 14 }}>Ajouter</button>
        </form>
      </section>
    </div>
  )
}
