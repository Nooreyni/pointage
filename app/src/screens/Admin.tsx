import { useCallback, useEffect, useMemo, useState } from 'react'
import Toast, { type MessageToast } from '../components/Toast'
import type { Acces, AdminPersonne, AdminService, Api, Compteur, Ferie, Parametre, Profil, Regime, Reseau, Role, SaisiePersonne } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { dateCourte, decalerJour, duree, hhmm, jourBxl } from '../lib/temps'
import Fenetre from '../components/Fenetre'
import MotDePasseRH from '../components/MotDePasseRH'
import SoldesPersonne from '../components/SoldesPersonne'
import DepartPersonne from '../components/DepartPersonne'
import ArriveePersonne from '../components/ArriveePersonne'
import ImportPersonnes from '../components/ImportPersonnes'
import ImportSoldes from '../components/ImportSoldes'
import TeletravailHabituel from '../components/TeletravailHabituel'
import HoraireHabituel from '../components/HoraireHabituel'
import { IcChevron } from '../components/Icones'
import { Pagination, usePagination } from '../components/Pagination'
import { LienPersonne, LienReglages, type OngletFiche } from '../lib/navigation'
import { FenetreAvis, LIBELLES_AVIS, quand } from '../components/Avis'
import Lancement from './Lancement'
import Export from '../components/Export'
import { telecharger, type Format } from '../lib/export'
import type { Avis } from '../lib/types'

const DOMAINES_CFB = ['centrefamilial.be', 'ceforbxl.be']

export type Section = 'services' | 'regimes' | 'acces' | 'compteurs' | 'parametres' | 'reseau' | 'journal' | 'avis' | 'lancement'
type Message = { texte: string; erreur?: boolean }

export const ROLES: Record<Role, string> = {
  employe: 'Employé', rh: 'RH', admin_rh: 'Admin RH', responsable_isp: 'Responsable ISP', direction: 'Direction', admin: 'Admin général',
}
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const enMin = (v: string) => { const [h, m] = (v || '0:0').split(':').map(Number); return h * 60 + (m || 0) }

/**
 * Gestion : `vue="personnes"` (RH, admin RH, admin) = la liste et les fiches des personnes ;
 * `vue="reglages"` (admin RH, admin) = services, régimes, accès, compteurs, paramètres, fériés, journal.
 */
export default function Admin({ api, profil, sectionInitiale, vue = 'reglages', ficheInitiale }: {
  api: Api; profil: Profil; sectionInitiale?: Section; vue?: 'personnes' | 'reglages'; ficheInitiale?: { id: string; onglet?: OngletFiche } | null
}) {
  const estAdmin = profil.role === 'admin'
  const [section, setSection] = useState<Section>(sectionInitiale ?? 'services')
  useEffect(() => { if (sectionInitiale) setSection(sectionInitiale) }, [sectionInitiale])
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
    ['services', 'Services'], ['regimes', 'Régimes'], ['acces', 'Accès'], ['compteurs', 'Compteurs'], ['parametres', 'Paramètres'],
    ['reseau', estAdmin ? 'Réseau & fériés' : 'Jours fériés'], ['journal', 'Journal'],
    ['lancement', 'Lancement'],
    ...(estAdmin ? [['avis', 'Avis des testeurs'] as [Section, string]] : []),
  ]

  return (
    <main className="contenu">
      {vue === 'personnes' ? (
        <div className="col-pleine pile">
          <Personnes personnes={personnes} services={services} regimes={regimes} monRole={profil.role} api={api} ok={ok} erreur={erreur} ficheInitiale={ficheInitiale} />
        </div>
      ) : (
      <div className="col-pleine pile">
        <div className="segments defilant" role="tablist" aria-label="Réglages">
          {sections.map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{l}</button>)}
        </div>
        {section === 'services' && <Services services={services} personnes={personnes ?? []} api={api} ok={ok} erreur={erreur} />}
        {section === 'regimes' && <Regimes regimes={regimes} api={api} ok={ok} erreur={erreur} />}
        {section === 'acces' && <AccesServices api={api} personnes={personnes ?? []} services={services} erreur={erreur} setMessage={setMessage} />}
        {section === 'compteurs' && <Compteurs api={api} estAdmin={['admin', 'admin_rh', 'direction'].includes(profil.role)} erreur={erreur} setMessage={setMessage} />}
        {section === 'parametres' && <Parametres api={api} profil={profil} erreur={erreur} setMessage={setMessage} />}
        {section === 'reseau' && <ReseauFeries api={api} estAdmin={estAdmin} erreur={erreur} setMessage={setMessage} />}
        {section === 'lancement' && <Lancement api={api} personnes={personnes ?? []} erreur={erreur} setMessage={setMessage} onComptes={charger} />}
        {section === 'avis' && estAdmin && <AvisTesteurs api={api} personnes={personnes ?? []} erreur={erreur} setMessage={setMessage} onTesteurs={charger} />}
        {section === 'journal' && <><div className="grille-cartes"><EtatSysteme api={api} /><ErreursAppli api={api} /></div><Journal api={api} erreur={erreur} /></>}
      </div>
      )}
      <Toast message={message} />
    </main>
  )
}

type Commun = { api: Api; ok: (t: string) => Promise<void>; erreur: (e: unknown) => void }


// ---------------------------------------------------------------------------
type FiltrePersonnes = 'actives' | 'sans_compte' | 'depart' | 'parties'
const peutGererRole = (moi: Role, r: Role) => moi === 'admin' || ((moi === 'admin_rh' || moi === 'direction') && r !== 'admin') || (moi === 'rh' && r !== 'admin' && r !== 'admin_rh')

export function Personnes({ personnes, services, regimes, monRole, api, ok, erreur, ficheInitiale }: Commun & {
  personnes: AdminPersonne[] | null; services: AdminService[]; regimes: Regime[]; monRole: Role
  ficheInitiale?: { id: string; onglet?: OngletFiche } | null
}) {
  const [filtre, setFiltre] = useState('')
  const [vue, setVue] = useState<FiltrePersonnes>('actives')
  const [fiche, setFiche] = useState<{ id: string | null; onglet?: OngletFiche } | null>(null)
  const [importer, setImport] = useState(false)
  const [soldes, setSoldes] = useState(false)
  const auj = jourBxl()
  // Fiche demandée depuis un autre écran (nom cliqué, recherche)
  useEffect(() => { if (ficheInitiale) setFiche(ficheInitiale) }, [ficheInitiale])

  const tous = personnes ?? []
  const partie = (p: AdminPersonne) => !!p.date_sortie && p.date_sortie < auj
  const groupes: Record<FiltrePersonnes, AdminPersonne[]> = {
    actives: tous.filter((p) => !partie(p)),
    sans_compte: tous.filter((p) => !partie(p) && !p.compte_lie),
    depart: tous.filter((p) => !!p.date_sortie && p.date_sortie >= auj),
    parties: tous.filter(partie),
  }
  const q = sansAccent(filtre)
  const [fService, setFService] = useState('')
  const [fRole, setFRole] = useState('')
  const liste = groupes[vue].filter((p) => (!fService || p.service === fService) && (!fRole || p.role === fRole)
    && sansAccent(`${p.prenom} ${p.nom} ${p.email} ${p.service} ${ROLES[p.role]}`).includes(q))
  const nomsServices = [...new Set(tous.map((p) => p.service))].sort((a, b) => a.localeCompare(b))
  const roles = [...new Set(tous.map((p) => p.role))]
  const pager = usePagination(liste, 25, `${vue}|${filtre}|${fService}|${fRole}`)
  const ouverte = fiche?.id ? tous.find((p) => p.id === fiche.id) ?? null : null

  return (
    <section className="carte">
      <div className="ligne entre barre-outils">
        <h2>Personnes <span className="doux petit">({groupes.actives.length})</span></h2>
        <span className="ligne">
          <button className="bouton secondaire petit" onClick={() => setImport(true)}>Importer</button>
          <button className="bouton secondaire petit" onClick={() => setSoldes(true)}>Reprendre des soldes</button>
          <button className="bouton petit" onClick={() => setFiche({ id: null })}>Nouvelle personne</button>
        </span>
      </div>
      <div className="outils-personnes">
        <input id="filtre-personnes" type="search" className="recherche pleine" placeholder="Rechercher un nom, un e-mail…" aria-label="Rechercher"
               value={filtre} onChange={(e) => setFiltre(e.target.value)} />
        <select aria-label="Service" value={fService} onChange={(e) => setFService(e.target.value)}>
          <option value="">Tous les services</option>
          {nomsServices.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select aria-label="Rôle" value={fRole} onChange={(e) => setFRole(e.target.value)}>
          <option value="">Tous les rôles</option>
          {roles.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
        </select>
      </div>
      <div className="filtres" role="group" aria-label="Filtrer">
        {([['actives', 'En poste'], ['sans_compte', 'Sans compte'], ['depart', 'Départ prévu'], ['parties', 'Parties']] as [FiltrePersonnes, string][])
          .filter(([id]) => id === 'actives' || groupes[id].length > 0)
          .map(([id, l]) => <button key={id} className="puce" aria-pressed={vue === id} onClick={() => setVue(id)}>{l} <b>{groupes[id].length}</b></button>)}
      </div>
      {importer && <ImportPersonnes api={api} services={services} regimes={regimes} existants={tous.map((p) => p.email.toLowerCase())}
                                    onFermer={() => setImport(false)} onFait={(n) => { if (n) ok(`${n} personne(s) importée(s)`) }} />}
      {soldes && <ImportSoldes api={api} personnes={tous} onFermer={() => setSoldes(false)} onFait={(n) => { if (n) ok(`${n} solde(s) repris`) }} />}
      {!personnes && <p className="vide">Chargement…</p>}
      {personnes && liste.length === 0 && <p className="vide">Personne ne correspond.</p>}
      <ul className="liste-personnes">{pager.items.map((p) => (
        <li key={p.id}>
          <button className="ligne-personne" onClick={() => setFiche({ id: p.id })}>
            <span className="qui"><strong>{p.nom} {p.prenom}</strong><span className="doux petit">{p.email}</span></span>
            <span className="ou">{p.service}<span className="doux petit">{ROLES[p.role]}{p.type === 'isp' ? ' · ISP' : ''}</span></span>
            <span className="etat">{partie(p) ? <span className="pilule neutre">Partie le {dateCourte(p.date_sortie!)}</span>
              : p.date_sortie ? <span className="pilule attente">Départ {dateCourte(p.date_sortie)}</span>
              : p.compte_lie ? <span className="pilule ok">Compte actif</span> : <span className="pilule attente">Sans compte</span>}</span>
            <IcChevron size={16} />
          </button>
        </li>
      ))}</ul>
      <Pagination pager={pager} quoi="personnes" />
      {fiche && (fiche.id === null || ouverte) && (
        <FichePersonne key={fiche.id ?? 'nouvelle'} personne={ouverte} ongletInitial={fiche.onglet} tous={tous} services={services} regimes={regimes}
                       monRole={monRole} api={api} onFermer={() => setFiche(null)} erreur={erreur}
                       onEnregistre={async (texte, id) => { await ok(texte); setFiche({ id, onglet: fiche.id === null ? 'compte' : fiche.onglet }) }} />
      )}
    </section>
  )
}


function FichePersonne({ personne, ongletInitial, tous, services, regimes, monRole, api, onFermer, onEnregistre, erreur }: {
  personne: AdminPersonne | null; ongletInitial?: OngletFiche; tous: AdminPersonne[]; services: AdminService[]; regimes: Regime[]; monRole: Role
  api: Api; onFermer: () => void; onEnregistre: (texte: string, id: string) => Promise<void>; erreur: (e: unknown) => void
}) {
  const [onglet, setOnglet] = useState<OngletFiche>(ongletInitial ?? 'identite')
  const [version, setVersion] = useState(0)   // recharge les encarts (arrivée) après une action
  // Message dans la fiche (sans la fermer)
  const [note, setNote] = useState<MessageToast>(null)
  const noter = (texte: string, e?: boolean) => { setNote({ texte, erreur: e }); setTimeout(() => setNote(null), e ? 6000 : 3500); if (!e) setVersion((v) => v + 1) }
  const verrouille = !!personne && !peutGererRole(monRole, personne.role)
  const auj = jourBxl()
  const enArrivee = !!personne && !personne.date_sortie && (!personne.compte_lie || personne.date_entree >= decalerJour(auj, -60))
  const recharger = async (texte: string) => { await onEnregistre(texte, personne!.id) }

  if (!personne) {
    return (
      <Fenetre titre="Nouvelle personne" onFermer={onFermer} large>
        <p className="doux petit" style={{ marginTop: 0 }}>Étape 1 sur 2 : l’identité. Ensuite, la fiche reste ouverte pour créer son compte et régler le reste.</p>
        <Identite personne={null} tous={tous} services={services} regimes={regimes} monRole={monRole} api={api} erreur={erreur}
                  onEnregistre={(id) => onEnregistre('Personne créée ✅', id)} onAnnuler={onFermer} />
      </Fenetre>
    )
  }

  const onglets: [OngletFiche, string][] = [['identite', 'Identité'], ['travail', 'Horaire'], ['compte', 'Compte'], ['soldes', 'Soldes'], ['depart', 'Départ']]
  return (
    <Fenetre titre={`${personne.prenom} ${personne.nom}`} onFermer={onFermer} large>
      <p className="entete-fiche doux petit">
        {personne.service} · {ROLES[personne.role]}{personne.type === 'isp' ? ' · ISP' : ''}
        {personne.date_sortie ? <span className="pilule attente">{personne.date_sortie < auj ? 'Partie' : 'Départ'} le {dateCourte(personne.date_sortie)}</span>
          : personne.compte_lie ? <span className="pilule ok">Compte actif</span> : <span className="pilule attente">Sans compte</span>}
      </p>
      {verrouille && <p className="attention petit">Seul un {personne.role === 'admin' ? 'admin général' : 'admin RH ou admin général'} peut modifier cette fiche.</p>}
      {enArrivee && !verrouille && <ArriveePersonne key={version} api={api} personne={personne} onFait={noter} onAller={setOnglet} />}

      <div className="segments onglets-fiche" role="tablist" aria-label="Sections de la fiche">
        {onglets.map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={onglet === id} onClick={() => setOnglet(id)}>{l}</button>)}
      </div>

      <div className="panneau-fiche" role="tabpanel">
        {onglet === 'identite' && (
          <Identite personne={personne} tous={tous} services={services} regimes={regimes} monRole={monRole} api={api} erreur={erreur}
                    verrouille={verrouille} onEnregistre={() => recharger('Fiche mise à jour ✅')} onAnnuler={onFermer} />
        )}
        {onglet === 'travail' && <>
          <h3 className="titre-bloc">Régime de travail</h3>
          <RegimePersonne personne={personne} regimes={regimes} api={api} verrouille={verrouille} erreur={erreur}
                          onFait={(t) => recharger(t)} />
          <h3 className="titre-bloc">Horaires habituels</h3>
          <HoraireHabituel api={api} personneId={personne.id} moi={false} />
          <h3 className="titre-bloc">Télétravail habituel</h3>
          <TeletravailHabituel api={api} personneId={personne.id} moi={false} sansEtiquette />
        </>}
        {onglet === 'compte' && <>
          <h3 className="titre-bloc">Compte de connexion</h3>
          {verrouille ? <p className="doux petit">Géré par un admin.</p> : <>
            <MotDePasseRH api={api} personneId={personne.id} compteLie={personne.compte_lie} onFait={() => setVersion((v) => v + 1)} />
            {personne.compte_lie && ['admin', 'admin_rh', 'direction'].includes(monRole) && <DelierCompte personne={personne} api={api} erreur={erreur} onFait={() => recharger('Compte délié')} />}
          </>}
        </>}
        {onglet === 'soldes' && <>
          <h3 className="titre-bloc">Soldes et compteurs</h3>
          <SoldesPersonne api={api} personneId={personne.id} onMessage={noter} />
        </>}
        {onglet === 'depart' && <>
          <h3 className="titre-bloc">Départ</h3>
          {verrouille ? <p className="doux petit">Géré par un admin.</p>
            : <DepartPersonne api={api} personneId={personne.id} nom={`${personne.prenom} ${personne.nom}`} dateSortie={personne.date_sortie}
                              onFait={(t, e) => (e ? noter(t, true) : recharger(t))} />}
        </>}
      </div>
      <Toast message={note} />
    </Fenetre>
  )
}

/** Identité : prénom, nom, e-mail, service, rôle, contrat, entrée (+ régime à la création). Le départ a son propre onglet. */
function Identite({ personne, tous, services, regimes, monRole, api, erreur, verrouille, onEnregistre, onAnnuler }: {
  personne: AdminPersonne | null; tous: AdminPersonne[]; services: AdminService[]; regimes: Regime[]; monRole: Role; api: Api
  erreur: (e: unknown) => void; verrouille?: boolean; onEnregistre: (id: string) => Promise<void>; onAnnuler?: () => void
}) {
  const [f, setF] = useState<SaisiePersonne>(() => personne
    ? { id: personne.id, prenom: personne.prenom, nom: personne.nom, email: personne.email, service_id: personne.service_id, role: personne.role,
        type: personne.type, partenaire_isp: personne.partenaire_isp, matricule: personne.matricule, date_entree: personne.date_entree,
        date_sortie: personne.date_sortie, regime_id: personne.regime_id }
    : { id: null, prenom: '', nom: '', email: '', service_id: '', role: 'employe', type: 'interne', partenaire_isp: null,
        matricule: null, date_entree: jourBxl(), date_sortie: null, regime_id: regimes.find((r) => r.actif)?.id ?? null })
  const [enCours, setEnCours] = useState(false)
  const [initial] = useState(() => JSON.stringify(f))
  const modifie = JSON.stringify(f) !== initial
  const maj = <K extends keyof SaisiePersonne>(k: K, v: SaisiePersonne[K]) => setF((x) => ({ ...x, [k]: v }))
  // Adresse proposée : prénom.nom@ le domaine le plus courant du CFB
  const domaine = useMemo(() => {
    const n = new Map<string, number>()
    for (const p of tous) { const d = p.email.split('@')[1]; if (d && !d.includes('invalide')) n.set(d, (n.get(d) ?? 0) + 1) }
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }, [tous])
  const normal = (t: string) => sansAccent(t).trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const proposee = !personne && domaine && f.prenom.trim() && f.nom.trim() ? `${normal(f.prenom)}.${normal(f.nom)}@${domaine}` : null
  const homonyme = !personne && f.prenom.trim() && f.nom.trim()
    ? tous.find((p) => sansAccent(p.prenom) === sansAccent(f.prenom.trim()) && sansAccent(p.nom) === sansAccent(f.nom.trim())) : undefined
  // Adresses du CFB : centrefamilial.be ou ceforbxl.be (simple avertissement, rien n'est bloqué)
  const domaineSaisi = f.email.trim().toLowerCase().split('@')[1] ?? ''
  const horsDomaine = !!domaineSaisi && !DOMAINES_CFB.includes(domaineSaisi) && !domaineSaisi.endsWith('.test')
  const emailPris = tous.find((p) => p.id !== personne?.id && p.email.toLowerCase() === f.email.trim().toLowerCase())

  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setEnCours(true)
      try { const id = await api.enregistrerPersonne({ ...f, email: f.email.trim() }); await onEnregistre(id) }
      catch (err) { erreur(err) } finally { setEnCours(false) }
    }}>
      <fieldset disabled={verrouille} className="sans-cadre">
        <div className="champs-ligne">
          <label className="champ">Prénom<input id="p-prenom" value={f.prenom} required autoComplete="off" onChange={(e) => maj('prenom', e.target.value)} /></label>
          <label className="champ">Nom<input id="p-nom" value={f.nom} required autoComplete="off" onChange={(e) => maj('nom', e.target.value)} /></label>
        </div>
        {homonyme && <p className="attention petit">Une fiche existe déjà à ce nom ({homonyme.service}{homonyme.date_sortie ? ', partie' : ''}) : vérifie qu’il ne s’agit pas de la même personne.</p>}
        <label className="champ"><span>E-mail professionnel <span className="doux">(identifiant de connexion)</span></span>
          <input id="p-email" type="email" value={f.email} required autoComplete="off" inputMode="email" onChange={(e) => maj('email', e.target.value)}
                 placeholder={proposee ?? 'prenom.nom@…'} /></label>
        {proposee && !f.email && <button type="button" className="lien petit suggestion" onClick={() => maj('email', proposee)}>Utiliser {proposee}</button>}
        {horsDomaine && <p className="attention petit">Adresse hors des domaines du CFB ({DOMAINES_CFB.join(', ')}) : à vérifier.</p>}
        {emailPris && <p className="negatif petit">Adresse déjà utilisée par {emailPris.prenom} {emailPris.nom}.</p>}
        <div className="champs-ligne">
          <label className="champ">Service
            <select id="p-service" value={f.service_id} required onChange={(e) => maj('service_id', e.target.value)}>
              {!f.service_id && <option value="" disabled>Choisir…</option>}
              {services.filter((s) => s.actif || s.id === f.service_id).map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</select></label>
          <label className="champ">Rôle
            <select id="p-role" value={f.role} onChange={(e) => maj('role', e.target.value as Role)}>
              {(Object.keys(ROLES) as Role[]).filter((r) => peutGererRole(monRole, r) || r === f.role)
                .map((r) => <option key={r} value={r} disabled={!peutGererRole(monRole, r)}>{ROLES[r]}</option>)}</select></label>
        </div>
        <div className="champs-ligne">
          <label className="champ">Contrat
            <select id="p-type" value={f.type} onChange={(e) => maj('type', e.target.value as 'interne' | 'isp')}>
              <option value="interne">Personnel CFB</option><option value="isp">ISP (article 60, CPAS)</option></select></label>
          {f.type === 'isp'
            ? <label className="champ">Partenaire<input id="p-partenaire" value={f.partenaire_isp ?? ''} required placeholder="CPAS de …"
                                                       onChange={(e) => maj('partenaire_isp', e.target.value)} /></label>
            : <label className="champ"><span>Matricule Partena <span className="doux">(facultatif)</span></span>
                <input id="p-matricule" value={f.matricule ?? ''} inputMode="numeric" onChange={(e) => maj('matricule', e.target.value)} /></label>}
        </div>
        <div className="champs-ligne">
          <label className="champ">Date d’entrée<input id="p-entree" type="date" value={f.date_entree} required onChange={(e) => maj('date_entree', e.target.value)} /></label>
          {!personne && (
            <label className="champ">Régime de travail
              <select id="p-regime" value={f.regime_id ?? ''} required onChange={(e) => maj('regime_id', Number(e.target.value))}>
                {regimes.filter((r) => r.actif).map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}</select></label>
          )}
        </div>
        <p className="doux petit">Chef de service : se règle dans <LienReglages section="services">Réglages › Services</LienReglages>.
          {personne && ' Départ : onglet « Départ ».'}</p>
        <div className="actions">
          {onAnnuler && <button type="button" className="bouton secondaire" onClick={onAnnuler}>{personne ? 'Fermer' : 'Annuler'}</button>}
          <button className="bouton" disabled={enCours || !!emailPris || (!!personne && !modifie)}>{enCours ? 'Enregistrement…' : personne ? 'Enregistrer' : 'Créer la fiche'}</button>
        </div>
      </fieldset>
    </form>
  )
}

function RegimePersonne({ personne, regimes, api, verrouille, erreur, onFait }: {
  personne: AdminPersonne; regimes: Regime[]; api: Api; verrouille: boolean; erreur: (e: unknown) => void; onFait: (t: string) => Promise<void>
}) {
  const regimeActuel = regimes.find((r) => r.id === personne.regime_id)
  const [joursAuChoix, setJoursAuChoix] = useState(false)
  const [nouveauRegime, setNouveauRegime] = useState<number>(personne.regime_id ?? regimes[0]?.id ?? 0)
  const [dateRegime, setDateRegime] = useState(() => (personne.date_entree > jourBxl() ? personne.date_entree : `${Number(jourBxl().slice(0, 4)) + 1}-01-01`))
  const [jours, setJours] = useState<boolean[]>(() => (regimeActuel?.minutes_jour ?? [1, 1, 1, 1, 1, 0, 0]).map((m) => m > 0))
  const [heuresJour, setHeuresJour] = useState(() => hhmm(Math.max(...(regimeActuel?.minutes_jour ?? [456])) || 456))
  return (
    <div>
      <p className="petit" style={{ marginTop: 0 }}>Actuel : <strong>{personne.regime ?? '—'}</strong>{personne.regime_depuis && ` depuis le ${dateCourte(personne.regime_depuis)}`}</p>
      {!verrouille && <>
        <div className="segments compact" role="radiogroup" aria-label="Type de régime" style={{ marginBottom: 10 }}>
          <button type="button" role="radio" aria-checked={!joursAuChoix} onClick={() => setJoursAuChoix(false)}>Régime existant</button>
          <button type="button" role="radio" aria-checked={joursAuChoix} onClick={() => setJoursAuChoix(true)}>Jours au choix</button>
        </div>
        {joursAuChoix ? (
          <>
            <div className="jours-tt" role="group" aria-label="Jours travaillés">
              {JOURS.map((j, i) => (
                <button key={j} type="button" className="puce" aria-pressed={jours[i]} onClick={() => setJours(jours.map((x, k) => (k === i ? !x : x)))}>{j}</button>
              ))}
            </div>
            <div className="champs-ligne">
              <label className="champ">Heures par jour<input id="p-heures-jour" type="time" value={heuresJour} onChange={(e) => setHeuresJour(e.target.value)} /></label>
              <label className="champ">À partir du<input id="p-date-regime-jours" type="date" value={dateRegime} onChange={(e) => setDateRegime(e.target.value)} /></label>
            </div>
            <p className="doux petit" style={{ marginTop: 0 }}>{jours.filter(Boolean).length} jour(s) · {duree(jours.filter(Boolean).length * enMin(heuresJour))} par semaine (4/5, 3/5…).</p>
            <button className="bouton secondaire" onClick={async () => {
              try { await api.regimePersonnalise(personne.id, jours.map((x) => (x ? enMin(heuresJour) : 0)), dateRegime); await onFait('Jours de travail enregistrés ✅') } catch (e) { erreur(e) }
            }}>Programmer ces jours</button>
          </>
        ) : (
          <>
            <div className="champs-ligne">
              <label className="champ">Nouveau régime
                <select id="p-nouveau-regime" value={nouveauRegime} onChange={(e) => setNouveauRegime(Number(e.target.value))}>
                  {regimes.filter((r) => r.actif).map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}</select></label>
              <label className="champ">À partir du<input id="p-date-regime" type="date" value={dateRegime} onChange={(e) => setDateRegime(e.target.value)} /></label>
            </div>
            <button className="bouton secondaire" onClick={async () => {
              try { await api.changerRegime(personne.id, nouveauRegime, dateRegime); await onFait('Changement de régime enregistré ✅') } catch (e) { erreur(e) }
            }}>Programmer le changement</button>
          </>
        )}
      </>}
    </div>
  )
}

function DelierCompte({ personne, api, erreur, onFait }: { personne: AdminPersonne; api: Api; erreur: (e: unknown) => void; onFait: () => Promise<void> }) {
  const [confirmer, setConfirmer] = useState(false)
  return (
    <div className="repli-delier">
      <p className="doux petit">Lié au compte <strong>{personne.email}</strong>. Délier seulement si un mauvais compte a été associé.</p>
      {confirmer
        ? <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button className="bouton danger" onClick={async () => { try { await api.delierCompte(personne.id); await onFait() } catch (e) { erreur(e) } finally { setConfirmer(false) } }}>Confirmer</button>
            <button className="bouton secondaire" onClick={() => setConfirmer(false)}>Annuler</button></div>
        : <button className="lien petit" onClick={() => setConfirmer(true)}>Délier le compte</button>}
    </div>
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
      <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
        <table className="tableau cliquable">
          <thead><tr><th>Service</th><th>Rattaché à</th><th>Chef(s)</th><th className="num">Effectif</th><th className="num">Seuil d’absence</th></tr></thead>
          <tbody>{services.map((s) => (
            <tr key={s.id} onClick={() => setEdition(s)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdition(s)}>
              <td><span className="pastille-service" style={{ background: s.couleur ?? '#B7BFD3' }} /><strong>{s.nom}</strong>
                {!s.actif && <span className="pilule neutre" style={{ marginLeft: 6 }}>inactif</span>}</td>
              <td className="doux">{services.find((x) => x.id === s.parent_id)?.nom ?? '—'}</td>
              <td>{s.chefs.length ? s.chefs.map((c, i) => <span key={c}>{i > 0 && ', '}<LienPersonne id={c} nom={nomDe(c)} /></span>) : <span className="doux">aucun → direction</span>}</td>
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
      <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
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
  const [jusquAu, setJusquAu] = useState('')
  const charger = useCallback(() => { api.acces().then(setListe).catch(erreur) }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  const candidats = useMemo(() => personnes.filter((p) => !p.date_sortie), [personnes])

  return (
    <section className="carte">
      <h2>Accès à d’autres services</h2>
      <p className="doux petit">Pour qu’un responsable voie (et éventuellement valide) les demandes d’un service qui n’est pas le sien.
        Remplacement pendant un congé : indique une date de fin, l’accès s’arrête tout seul. La personne est prévenue.</p>
      <form className="champs-ligne aligne-bas" onSubmit={async (e) => {
        e.preventDefault()
        try { await api.donnerAcces(personne, service, valider, jusquAu || null); setMessage({ texte: jusquAu ? `Accès accordé jusqu’au ${dateCourte(jusquAu)} ✅` : 'Accès accordé ✅' }); setJusquAu(''); charger() } catch (err) { erreur(err) }
      }}>
        <label className="champ">Personne<select id="a-personne" value={personne} required onChange={(e) => setPersonne(e.target.value)}>
          <option value="" disabled>Choisir…</option>{candidats.map((p) => <option key={p.id} value={p.id}>{p.nom} {p.prenom} — {p.service}</option>)}</select></label>
        <label className="champ">Service<select id="a-service" value={service} required onChange={(e) => setService(e.target.value)}>
          <option value="" disabled>Choisir…</option>{services.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</select></label>
        <label className="champ">Droit<select id="a-droit" value={valider ? '1' : '0'} onChange={(e) => setValider(e.target.value === '1')}>
          <option value="0">Lecture seule</option><option value="1">Lecture + validation</option></select></label>
        <label className="champ"><span>Jusqu’au <span className="doux">(facultatif)</span></span>
          <input id="a-jusqu" type="date" value={jusquAu} min={jourBxl()} onChange={(e) => setJusquAu(e.target.value)} /></label>
        <button className="bouton" style={{ marginBottom: 14 }}>Accorder</button>
      </form>
      {liste.length === 0 ? <p className="vide">Aucun accès particulier.</p> : (
        <ul className="liste">{liste.map((a) => (
          <li key={a.personne_id + a.service_id}>
            <span className="texte-ligne"><LienPersonne id={a.personne_id} nom={`${a.prenom} ${a.nom}`} /> → {a.service}</span>
            <span className={`pilule ${a.actif === false ? 'neutre' : a.peut_valider ? 'ok' : 'neutre'}`}>{a.peut_valider ? 'Lecture + validation' : 'Lecture'}</span>
            {a.jusqu_au && <span className={`pilule ${a.actif === false ? 'ko' : 'attente'}`}>{a.actif === false ? `Expiré le ${dateCourte(a.jusqu_au)}` : `Jusqu’au ${dateCourte(a.jusqu_au)}`}</span>}
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
const euros = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`
function valeurLisible(p: Parametre): string {
  if (p.unite === 'booleen') return p.valeur ? 'Oui' : 'Non'
  if (p.unite === 'centimes') return p.valeur === 0 && p.cle.includes('plafond') ? 'Sans plafond' : `${euros(p.valeur)} HT`
  if (p.valeur === 0 && p.cle.startsWith('conservation')) return 'Sans limite'
  if (p.valeur === 0 && p.cle === 'stats_seuil_anonymat') return 'Jamais'
  if (p.unite === 'min') return duree(p.valeur)
  if (p.unite === 'min_depuis_minuit') return hhmm(p.valeur)
  return `${p.valeur} ${p.unite}`
}
const ORDRE_CATEGORIES = ['Temps de travail', 'Télétravail', 'Congés et absences', 'Rappels', 'Confidentialité', 'Conservation', 'Sécurité']
const sansAccent = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Réglages : regroupés par thème. Une fonction a son interrupteur, ses réglages apparaissent dessous quand elle est active.
 * Chaque valeur provisoire porte « À confirmer » et un bouton « Confirmer ». Tout changement est tracé (qui, quand, source).
 */
function Parametres({ api, profil, erreur, setMessage }: { api: Api; profil: Profil; erreur: (e: unknown) => void; setMessage: (m: Message) => void }) {
  const [liste, setListe] = useState<Parametre[]>([])
  const [edition, setEdition] = useState<{ cle: string; valeur: string } | null>(null)
  const [q, setQ] = useState('')
  const [aConfirmer, setAConfirmer] = useState(false)
  const [avisSur, setAvisSur] = useState<Parametre | null>(null)
  const charger = useCallback(() => { api.parametres().then(setListe).catch(erreur) }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  const source = `Réglé par ${profil.prenom} ${profil.nom} le ${new Date().toLocaleDateString('fr-BE')}`
  const enregistrer = async (p: Parametre, valeur: number, texte = 'Enregistré') => {
    try { await api.modifierParametre(p.cle, valeur, source); setEdition(null); setMessage({ texte }); charger() } catch (e) { erreur(e) }
  }
  const provisoires = liste.filter((p) => p.provisoire).length
  const filtre = (p: Parametre) => (!aConfirmer || p.provisoire) && (!q || sansAccent(`${p.libelle} ${p.categorie} ${p.aide ?? ''}`).includes(sansAccent(q)))
  const enfants = (cle: string) => liste.filter((x) => x.parent === cle).sort((a, b) => (a.ordre ?? 100) - (b.ordre ?? 100))
  const racines = liste.filter((p) => !p.parent)
  const categories = [...new Set(racines.map((p) => p.categorie || 'Autres'))]
    .sort((a, b) => (ORDRE_CATEGORIES.indexOf(a) + 99) % 99 - (ORDRE_CATEGORIES.indexOf(b) + 99) % 99 || a.localeCompare(b))
  const visible = (p: Parametre) => filtre(p) || enfants(p.cle).some(filtre)

  const ligne = (p: Parametre, enfant = false) => {
    const enEdition = edition?.cle === p.cle
    return (
      <li key={p.cle} className={`reglage ${enfant ? 'enfant' : ''}`}>
        <div className="reglage-texte">
          <span className="reglage-libelle">{p.libelle}{p.provisoire && <span className="pilule attente">À confirmer</span>}</span>
          {p.aide && <span className="doux petit">{p.aide}</span>}
          {!p.provisoire && p.source && <span className="doux petit">{p.source}</span>}
        </div>
        <div className="reglage-controle">
          {p.unite === 'booleen' && p.options?.length === 2 ? (
            <div className="segments compact" role="radiogroup" aria-label={p.libelle}>
              {p.options.map((o, i) => (
                <button key={o} type="button" role="radio" aria-checked={p.valeur === i} onClick={() => p.valeur !== i && enregistrer(p, i)}>{o}</button>
              ))}
            </div>
          ) : p.unite === 'booleen' ? (
            <button className="interrupteur" role="switch" aria-checked={p.valeur === 1} aria-label={p.libelle}
                    onClick={() => enregistrer(p, p.valeur ? 0 : 1, p.valeur ? 'Désactivé' : 'Activé')}><span /></button>
          ) : enEdition ? (
            <form className="edition-reglage" onSubmit={(e) => {
              e.preventDefault()
              const v = p.unite === 'min_depuis_minuit' ? enMin(edition.valeur) : p.unite === 'centimes' ? Math.round(Number(edition.valeur.replace(',', '.')) * 100) : Number(edition.valeur)
              if (!Number.isFinite(v)) return erreur(new Error('Valeur invalide'))
              enregistrer(p, v)
            }}>
              <input id={`param-${p.cle}`} aria-label={p.libelle} autoFocus required value={edition.valeur}
                     type={p.unite === 'min_depuis_minuit' ? 'time' : 'text'} inputMode={p.unite === 'min_depuis_minuit' ? undefined : 'decimal'}
                     onChange={(e) => setEdition({ cle: p.cle, valeur: e.target.value })} />
              <span className="doux petit">{p.unite === 'centimes' ? '€ HT' : p.unite === 'min_depuis_minuit' ? '' : p.unite}</span>
              <button className="bouton petit">OK</button>
              <button type="button" className="lien petit" onClick={() => setEdition(null)}>Annuler</button>
            </form>
          ) : (
            <button className="valeur-reglage" onClick={() => setEdition({ cle: p.cle, valeur: p.unite === 'min_depuis_minuit' ? hhmm(p.valeur)
              : p.unite === 'centimes' ? (p.valeur / 100).toFixed(2).replace('.', ',') : String(p.valeur) })} title="Modifier">
              {valeurLisible(p)}<span className="doux petit">Modifier</span>
            </button>
          )}
          {p.provisoire && !enEdition && <button className="lien petit" onClick={() => enregistrer(p, p.valeur, 'Valeur confirmée')}>Confirmer</button>}
          {profil.testeur && !enEdition && <button className="lien petit" onClick={() => setAvisSur(p)} title="Donner mon avis sur ce réglage">Commenter</button>}
        </div>
      </li>
    )
  }

  return (
    <>
      <section className="carte">
        <div className="ligne entre barre-outils">
          <h2>Réglages {provisoires > 0 && <span className="pilule attente">{provisoires} à confirmer</span>}</h2>
          <input id="recherche-reglages" type="search" className="recherche" placeholder="Chercher un réglage…" aria-label="Chercher un réglage" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="case-a-cocher petit"><input type="checkbox" checked={aConfirmer} onChange={(e) => setAConfirmer(e.target.checked)} />Seulement les valeurs à confirmer</label>
        <p className="doux petit" style={{ margin: 0 }}>Active ou coupe une fonction avec son interrupteur ; ses réglages apparaissent juste en dessous. Chaque changement est enregistré dans le journal (qui, quand).</p>
        {profil.testeur && <p className="petit attention" style={{ margin: 0 }}>Test : pour chaque réglage, « Commenter » envoie ton avis à l’IT (je confirme / à changer), sans rien modifier.</p>}
      </section>
      {avisSur && <FenetreAvis api={api} ecran="Réglages › Paramètres" parametre={{ cle: avisSur.cle, libelle: avisSur.libelle, valeur: valeurLisible(avisSur) }}
                              onFermer={() => setAvisSur(null)} onEnvoye={(t) => { setAvisSur(null); setMessage({ texte: t }) }} />}
      <div className="grille-cartes maconnerie">
        {categories.map((c) => {
          const items = racines.filter((p) => (p.categorie || 'Autres') === c && visible(p)).sort((a, b) => (a.ordre ?? 100) - (b.ordre ?? 100) || a.libelle.localeCompare(b.libelle))
          if (!items.length) return null
          return (
            <section key={c} className="carte">
              <h2>{c}</h2>
              <ul className="liste-reglages">
                {items.map((p) => {
                  const sous = enfants(p.cle)
                  const actif = p.unite !== 'booleen' || p.valeur === 1
                  return [ligne(p), ...(sous.length && actif ? sous.filter((x) => !q && !aConfirmer ? true : filtre(x) || filtre(p)).map((x) => ligne(x, true)) : []),
                    ...(sous.length && !actif ? [<li key={p.cle + '-off'} className="reglage enfant doux petit">Fonction coupée : {sous.length} réglage(s) masqué(s)</li>] : [])]
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
const PERIODICITES: Record<Compteur['periodicite'], string> = { annuelle: 'Annuelle', trimestrielle: 'Trimestrielle', aucune: 'Sans période' }
const REPORTS: Record<Compteur['report_mode'], string> = { perdu: 'Perdu en fin de période', total: 'Reporté en totalité', plafonne: 'Reporté avec un plafond' }

function Compteurs({ api, estAdmin, erreur, setMessage }: { api: Api; estAdmin: boolean; erreur: (e: unknown) => void; setMessage: (m: Message) => void }) {
  const [liste, setListe] = useState<Compteur[] | null>(null)
  const [edition, setEdition] = useState<Compteur | null>(null)
  const charger = useCallback(() => { api.compteurs().then(setListe).catch(erreur) }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  const libelleDe = (code: string | null) => liste?.find((c) => c.code === code)?.libelle ?? code ?? '—'
  const reportLisible = (c: Compteur) => c.periodicite === 'aucune' ? 'Pas de fin de période'
    : c.report_mode === 'plafonne' ? `Max ${duree(c.report_plafond_min ?? 0)} vers ${libelleDe(c.report_vers ?? c.code)}`
    : c.report_mode === 'total' ? `Tout vers ${libelleDe(c.report_vers ?? c.code)}` : 'Perdu'

  return (
    <section className="carte">
      <div className="ligne entre"><h2>Compteurs</h2>
        {liste?.some((c) => c.regle_provisoire) && <span className="pilule attente">{liste.filter((c) => c.regle_provisoire).length} règle(s) à confirmer</span>}</div>
      <p className="doux petit">Congés, récup, boni… Pour chaque compteur : sa période, si le solde peut être négatif et ce qui arrive au reste en fin de période (report appliqué à la clôture du dernier mois de la période).</p>
      {!liste && <p className="vide">Chargement…</p>}
      <div className="tableau-defilant" tabIndex={0} role="region" aria-label="Tableau, défilable">
        <table className="tableau">
          <thead><tr><th>Compteur</th><th>Période</th><th>Négatif</th><th>Visible employé</th><th>Fin de période</th><th /></tr></thead>
          <tbody>{liste?.map((c) => (
            <tr key={c.code} className={c.actif ? '' : 'inactif'}>
              <td><strong>{c.libelle}</strong><div className="doux petit">{c.code}{!c.actif && ' · désactivé'}</div></td>
              <td>{PERIODICITES[c.periodicite]}</td>
              <td>{c.autorise_negatif ? 'Autorisé' : 'Bloqué'}</td>
              <td>{c.visible_employe ? 'Oui' : 'Non'}</td>
              <td>{reportLisible(c)}{c.regle_provisoire && <div><span className="pilule attente">Provisoire</span></div>}</td>
              <td>{estAdmin && <button className="lien petit" onClick={() => setEdition({ ...c })}>Modifier</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {edition && (
        <Fenetre titre={`Compteur : ${edition.libelle}`} onFermer={() => setEdition(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault()
            try { await api.enregistrerCompteur(edition); setEdition(null); setMessage({ texte: 'Compteur enregistré ✅' }); charger() }
            catch (err) { erreur(err) }
          }}>
            <label className="champ">Libellé<input id="compteur-libelle" value={edition.libelle} required onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} /></label>
            <label className="champ">Période
              <select id="compteur-periode" value={edition.periodicite} onChange={(e) => setEdition({ ...edition, periodicite: e.target.value as Compteur['periodicite'] })}>
                {Object.entries(PERIODICITES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            {edition.periodicite !== 'aucune' && <>
              <label className="champ">En fin de période, le solde restant est…
                <select id="compteur-report" value={edition.report_mode} onChange={(e) => setEdition({ ...edition, report_mode: e.target.value as Compteur['report_mode'] })}>
                  {Object.entries(REPORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></label>
              {edition.report_mode !== 'perdu' && (
                <div className="champs-ligne">
                  <label className="champ">Reporté vers
                    <select id="compteur-vers" value={edition.report_vers ?? edition.code} onChange={(e) => setEdition({ ...edition, report_vers: e.target.value === edition.code ? null : e.target.value })}>
                      {liste!.map((c) => <option key={c.code} value={c.code}>{c.code === edition.code ? 'Le même compteur' : c.libelle}</option>)}
                    </select></label>
                  {edition.report_mode === 'plafonne' && (
                    <label className="champ">Plafond (heures)
                      <input id="compteur-plafond" type="number" min={0} step={0.5} required value={edition.report_plafond_min === null ? '' : edition.report_plafond_min / 60}
                             onChange={(e) => setEdition({ ...edition, report_plafond_min: e.target.value === '' ? null : Math.round(Number(e.target.value) * 60) })} /></label>
                  )}
                </div>
              )}
              <p className="doux petit" style={{ marginTop: 0 }}>Un solde négatif suit toujours la personne (il n’est jamais effacé).</p>
            </>}
            <label className="case-a-cocher"><input type="checkbox" checked={edition.autorise_negatif} onChange={(e) => setEdition({ ...edition, autorise_negatif: e.target.checked })} />
              Autoriser un solde négatif (avec alerte au N+1)</label>
            <label className="case-a-cocher"><input type="checkbox" checked={edition.visible_employe} onChange={(e) => setEdition({ ...edition, visible_employe: e.target.checked })} />
              Visible par l’employé dans « Mes soldes »</label>
            <label className="case-a-cocher"><input type="checkbox" checked={edition.actif} onChange={(e) => setEdition({ ...edition, actif: e.target.checked })} />
              Compteur actif</label>
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
            <li key={r.plage}><code className="texte-ligne">{r.plage}</code><span className="doux">{r.libelle}</span>
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
          <li key={f.jour}><span style={{ width: 110 }}>{dateCourte(f.jour)} {f.jour.slice(0, 4)}</span><span className="texte-ligne">{f.libelle}</span>
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

// ---------------------------------------------------------------------------
const OBJETS: Record<string, string> = {
  personnes: 'Personne', demandes: 'Demande de congé', pointages: 'Pointage', parametres: 'Réglage', mouvements_compteur: 'Solde',
  comptes: 'Compte / mot de passe', regimes: 'Régime', personne_regimes: 'Régime d’une personne', services: 'Service', responsables_service: 'Chef de service',
  acces_services: 'Accès délégué', teletravail_prevu: 'Télétravail habituel', clotures: 'Clôture du mois', decisions_hs: 'Heures au-delà du max',
  jours_feries: 'Jour férié', compteurs: 'Compteur',
}
const ACTIONS: Record<string, string> = { INSERT: 'Ajout', UPDATE: 'Modification', DELETE: 'Suppression' }

/** Journal : qui a changé quoi et quand (règles, personnes, soldes, congés, pointages…). Lecture seule, rien ne s'efface. */
// Erreurs remontées automatiquement par l'appli (écran planté chez quelqu'un) : pour l'IT, pendant le pilote surtout
const TACHES: Record<string, string> = { 'cfb-envoi': 'Envoi des notifications', 'cfb-rappels': 'Rappels automatiques', 'cfb-surveillance': 'Surveillance',
  'cfb-conservation': 'Nettoyage nocturne', 'cfb-anonymisation': 'Anonymisation des partis' }
const ilYa = (iso: string | null) => {
  if (!iso) return 'jamais'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`
}

/** État du système (admin, admin RH) : la surveillance horaire alerte aussi l'admin général par notification. */
function EtatSysteme({ api }: { api: Api }) {
  const [etat, setEtat] = useState<Awaited<ReturnType<Api['santeSysteme']>> | null>(null)
  const [erreur, setErreur] = useState(false)
  const charger = useCallback(() => { setErreur(false); api.santeSysteme().then(setEtat).catch(() => setErreur(true)) }, [api])
  useEffect(() => { charger() }, [charger])
  if (erreur) return null
  if (!etat) return <section className="carte"><h2>État du système</h2><p className="vide">Vérification…</p></section>
  const taches = Object.entries(etat.derniers_passages).sort(([a], [b]) => (TACHES[a] ?? a).localeCompare(TACHES[b] ?? b))
  return (
    <section className="carte etat-systeme">
      <div className="ligne entre"><h2>État du système</h2>
        {etat.ok ? <span className="pilule ok">Tout fonctionne</span> : <span className="pilule ko">{etat.problemes.length} problème(s)</span>}</div>
      {etat.problemes.length > 0 && <ul className="liste">{etat.problemes.map((p) => (
        <li key={p.code}><span className="texte-ligne"><strong className="negatif">{p.titre}</strong>{p.detail && <div className="doux petit">{p.detail}</div>}</span></li>
      ))}</ul>}
      {etat.avertissements.length > 0 && <ul className="liste">{etat.avertissements.map((p) => (
        <li key={p.code}><span className="texte-ligne"><strong className="attention">{p.titre}</strong>{p.detail && <div className="doux petit">{p.detail}</div>}</span></li>
      ))}</ul>}
      {taches.length > 0 && <dl className="taches-systeme">{taches.map(([t, d]) => (
        <div key={t}><dt>{TACHES[t] ?? t}</dt><dd>{ilYa(d)}</dd></div>
      ))}</dl>}
      <div className="ligne entre"><span className="doux petit">Vérifié {ilYa(etat.verifie_le)} · contrôle automatique toutes les heures, alerte à l’admin général en cas de panne.</span>
        <button className="lien petit" onClick={charger}>Actualiser</button></div>
    </section>
  )
}

function ErreursAppli({ api }: { api: Api }) {
  const [liste, setListe] = useState<Awaited<ReturnType<Api['erreursRecentes']>> | null>(null)
  useEffect(() => { api.erreursRecentes(7).then(setListe).catch(() => setListe([])) }, [api])
  if (!liste) return null
  return (
    <section className="carte">
      <div className="ligne entre"><h2>Erreurs de l’appli</h2><span className="doux petit">7 derniers jours</span></div>
      {liste.length === 0 ? <p className="positif petit" style={{ marginBottom: 0 }}>Aucune erreur signalée.</p> : (
        <ul className="liste">{liste.map((e, i) => (
          <li key={i}><span className="texte-ligne"><strong>{e.message}</strong>
            <div className="doux petit">{e.ecran ?? 'écran inconnu'} · {e.qui ?? '—'} · {new Date(e.quand).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}
              {e.fois > 1 && ` · ${e.fois} fois`}{e.version && ` · v${e.version}`}</div></span></li>
        ))}</ul>
      )}
    </section>
  )
}

function Journal({ api, erreur }: { api: Api; erreur: (e: unknown) => void }) {
  const [objet, setObjet] = useState<string>('')
  const [liste, setListe] = useState<import('../lib/types').Modification[] | null>(null)
  const [ouvert, setOuvert] = useState<number | null>(null)
  useEffect(() => { setListe(null); api.journal(300, objet || null).then(setListe).catch((e) => { setListe([]); erreur(e) }) }, [api, objet, erreur])
  const [cherche, setCherche] = useState('')
  const qj = sansAccent(cherche)
  const filtres = (liste ?? []).filter((m) => !qj || sansAccent(`${m.qui} ${OBJETS[m.objet] ?? m.objet} ${JSON.stringify(m.apres ?? m.avant ?? {})}`).includes(qj))
  const pager = usePagination(filtres, 20, `${objet}|${cherche}`)
  const resume = (v: Record<string, unknown> | null) => (v ? (v.prenom && v.nom ? `${v.prenom} ${v.nom}` : (v.cle ?? v.libelle ?? v.nom ?? '') as string) : '')
  return (
    <section className="carte">
      <div className="ligne entre barre-outils">
        <h2>Journal des modifications</h2>
        <span className="ligne outils-journal">
          <input type="search" className="recherche" placeholder="Qui, quoi…" aria-label="Chercher dans le journal" value={cherche} onChange={(e) => setCherche(e.target.value)} />
          <select id="journal-objet" className="choix" aria-label="Type d’élément" value={objet} onChange={(e) => setObjet(e.target.value)}>
            <option value="">Tout</option>
            {Object.entries(OBJETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </span>
      </div>
      <p className="doux petit">Chaque changement est enregistré avec son auteur et ne peut pas être effacé. Les 300 plus récents, 20 par page.</p>
      {!liste && <p className="vide">Chargement…</p>}
      {liste && filtres.length === 0 && <p className="vide">Aucune modification.</p>}
      <ul className="liste">{pager.items.map((m) => (
        <li key={m.id} className="ligne-journal">
          <span className="texte-ligne">
            <strong>{ACTIONS[m.action]} · {OBJETS[m.objet] ?? m.objet}</strong> {resume(m.apres ?? m.avant) && <span>{resume(m.apres ?? m.avant)}</span>}
            <div className="doux petit">{m.qui} · {new Date(m.quand).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}
              {m.action === 'UPDATE' && m.champs.length > 0 && <> · {m.champs.filter((c) => !['modifie_le', 'cree_le'].includes(c)).slice(0, 4).join(', ')}</>}</div>
            {ouvert === m.id && m.action === 'UPDATE' && (
              <table className="tableau detail-journal"><tbody>{m.champs.map((c) => (
                <tr key={c}><td>{c}</td><td className="doux">{JSON.stringify(m.avant?.[c] ?? null)}</td><td>→ {JSON.stringify(m.apres?.[c] ?? null)}</td></tr>
              ))}</tbody></table>
            )}
          </span>
          {m.action === 'UPDATE' && m.avant && <button className="lien petit" aria-expanded={ouvert === m.id} onClick={() => setOuvert(ouvert === m.id ? null : m.id)}>{ouvert === m.id ? 'Masquer' : 'Détail'}</button>}
        </li>
      ))}</ul>
      <Pagination pager={pager} quoi="modifications" />
    </section>
  )
}

/**
 * Avis des testeurs (admin général) : qui teste, ce qu'ils ont dit, « Traité » quand c'est pris en compte.
 * Désigner un testeur lui reproposera la visite guidée à sa prochaine ouverture.
 */
function AvisTesteurs({ api, personnes, erreur, setMessage, onTesteurs }: {
  api: Api; personnes: AdminPersonne[]; erreur: (e: unknown) => void; setMessage: (m: Message) => void; onTesteurs: () => void
}) {
  const [liste, setListe] = useState<Avis[] | null>(null)
  const [tout, setTout] = useState(false)
  const [vueAvis, setVueAvis] = useState<'liste' | 'synthese'>('liste')
  const [ajout, setAjout] = useState('')
  const charger = useCallback(() => { api.avisRecus().then(setListe).catch(erreur) }, [api, erreur])
  useEffect(() => { charger() }, [charger])
  const testeurs = personnes.filter((p) => p.testeur)
  const candidats = personnes.filter((p) => !p.testeur && p.compte_lie && !p.date_sortie).sort((a, b) => a.nom.localeCompare(b.nom))
  const ouverts = (liste ?? []).filter((a) => !a.traite_le)
  const affiches = tout ? (liste ?? []) : ouverts
  const pager = usePagination(affiches, 20, tout)
  const changerTesteur = async (id: string, actif: boolean) => {
    try { await api.definirTesteur(id, actif); setMessage({ texte: actif ? 'Testeur ajouté : la visite guidée s’ouvrira à sa prochaine connexion' : 'Testeur retiré' }); setAjout(''); onTesteurs() } catch (e) { erreur(e) }
  }
  const traiter = async (a: Avis, traite: boolean) => { try { await api.traiterAvis(a.id, traite); charger() } catch (e) { erreur(e) } }
  const exporter = (format: Format) => telecharger(
    [['Date', 'Personne', 'Rôle', 'Type', 'Écran', 'Réglage', 'Message', 'Traité le'],
     ...(liste ?? []).map((a) => [quand(a.cree_le), `${a.prenom} ${a.nom}`, ROLES[a.role as Role] ?? a.role ?? '', LIBELLES_AVIS[a.type], a.ecran ?? '',
       a.parametre_libelle ?? a.parametre ?? '', a.message ?? '', a.traite_le ? quand(a.traite_le) : ''])],
    `avis-testeurs-${new Date().toISOString().slice(0, 10)}`, format, 'Avis des testeurs')

  return (
    <div className="grille-cartes">
      <section className="carte">
        <h2>Testeurs <span className="doux petit">({testeurs.length})</span></h2>
        <p className="doux petit" style={{ margin: 0 }}>Ils voient une visite guidée à l’ouverture, un bouton « Mon avis » sur chaque écran et « Commenter » sur chaque réglage.</p>
        <ul className="liste-simple">
          {testeurs.map((p) => (
            <li key={p.id} className="ligne entre"><span>{p.prenom} {p.nom} <span className="doux petit">· {ROLES[p.role]}</span></span>
              <button className="lien petit" onClick={() => changerTesteur(p.id, false)}>Retirer</button></li>
          ))}
          {!testeurs.length && <li className="doux petit">Aucun testeur pour l’instant.</li>}
        </ul>
        <form className="ligne" onSubmit={(e) => { e.preventDefault(); if (ajout) changerTesteur(ajout, true) }}>
          <select id="ajout-testeur" className="choix" aria-label="Ajouter un testeur" value={ajout} onChange={(e) => setAjout(e.target.value)}>
            <option value="">Ajouter une personne (avec compte)…</option>
            {candidats.map((p) => <option key={p.id} value={p.id}>{p.nom} {p.prenom}</option>)}
          </select>
          <button className="bouton petit" disabled={!ajout}>Ajouter</button>
        </form>
      </section>
      <section className="carte col-pleine">
        <div className="ligne entre barre-outils">
          <h2>Avis reçus {ouverts.length > 0 && <span className="pilule attente">{ouverts.length} à traiter</span>}</h2>
          <span className="ligne">
            <div className="segments compact" role="radiogroup" aria-label="Affichage">
              <button type="button" role="radio" aria-checked={vueAvis === 'liste'} onClick={() => setVueAvis('liste')}>Liste</button>
              <button type="button" role="radio" aria-checked={vueAvis === 'synthese'} onClick={() => setVueAvis('synthese')}>Synthèse</button>
            </div>
            <Export disabled={!liste?.length} onExporter={exporter} />
          </span>
        </div>
        {vueAvis === 'synthese' ? <SyntheseAvis avis={liste ?? []} /> : <>
        <label className="case-a-cocher petit"><input type="checkbox" checked={tout} onChange={(e) => setTout(e.target.checked)} />Voir aussi les avis traités</label>
        {liste === null ? <div className="squelette">Chargement…</div> : !affiches.length ? <p className="doux petit">Aucun avis {tout ? '' : 'à traiter'} pour l’instant.</p> : (
          <ul className="liste-avis">
            {pager.items.map((a) => (
              <li key={a.id} className={a.traite_le ? 'traite' : ''}>
                <div className="ligne entre">
                  <span><span className={`pilule ${a.type === 'probleme' || a.type === 'reglage_changer' ? 'attente' : a.type === 'ok' || a.type === 'reglage_ok' ? 'ok' : 'neutre'}`}>{LIBELLES_AVIS[a.type]}</span>
                    {' '}<strong>{a.prenom} {a.nom}</strong> <span className="doux petit">· {a.parametre_libelle ?? a.ecran ?? '—'} · {quand(a.cree_le)}</span></span>
                  {a.traite_le
                    ? <button className="lien petit" onClick={() => traiter(a, false)}>Rouvrir</button>
                    : <button className="bouton secondaire petit" onClick={() => traiter(a, true)}>Traité</button>}
                </div>
                {a.message && <p className="petit" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.message}</p>}
              </li>
            ))}
          </ul>
        )}
        <Pagination pager={pager} quoi="avis" />
        </>}
      </section>
    </div>
  )
}

/**
 * Synthèse des avis (tous, traités compris) : d'abord les réglages commentés (confirmés / à changer, avec les
 * valeurs proposées), puis les écrans (problèmes, idées, questions, satisfaits). Pour préparer la réunion de retour.
 */
function SyntheseAvis({ avis }: { avis: Avis[] }) {
  if (!avis.length) return <p className="doux petit">Aucun avis pour l’instant.</p>
  const reglages = new Map<string, { libelle: string; ok: Avis[]; changer: Avis[] }>()
  const ecrans = new Map<string, Record<'probleme' | 'idee' | 'question' | 'ok', Avis[]>>()
  for (const a of avis) {
    if (a.parametre) {
      const r = reglages.get(a.parametre) ?? { libelle: a.parametre_libelle ?? a.parametre, ok: [], changer: [] }
      if (a.type === 'reglage_ok') r.ok.push(a); else r.changer.push(a)
      reglages.set(a.parametre, r)
    } else if (a.type === 'probleme' || a.type === 'idee' || a.type === 'question' || a.type === 'ok') {
      const k = a.ecran ?? 'Autre'
      const e = ecrans.get(k) ?? { probleme: [], idee: [], question: [], ok: [] }
      e[a.type].push(a); ecrans.set(k, e)
    }
  }
  const noms = (l: Avis[]) => [...new Set(l.map((a) => a.prenom))].join(', ')
  const triReglages = [...reglages.values()].sort((x, y) => y.changer.length - x.changer.length || x.libelle.localeCompare(y.libelle))
  const triEcrans = [...ecrans.entries()].sort((x, y) => (y[1].probleme.length + y[1].idee.length) - (x[1].probleme.length + x[1].idee.length))
  return (
    <div className="pile synthese-avis">
      {triReglages.length > 0 && <>
        <h3>Réglages commentés <span className="doux petit">({triReglages.length})</span></h3>
        <ul className="liste-avis">
          {triReglages.map((r) => (
            <li key={r.libelle}>
              <div className="ligne entre"><strong>{r.libelle}</strong>
                <span className="ligne">{r.ok.length > 0 && <span className="pilule ok" title={noms(r.ok)}>{r.ok.length} confirmé{r.ok.length > 1 ? 's' : ''}</span>}
                  {r.changer.length > 0 && <span className="pilule attente" title={noms(r.changer)}>{r.changer.length} à changer</span>}</span></div>
              {r.changer.map((a) => <p key={a.id} className="petit" style={{ margin: 0 }}>« {a.message} » <span className="doux">— {a.prenom}</span></p>)}
            </li>
          ))}
        </ul>
      </>}
      {triEcrans.length > 0 && <>
        <h3>Par écran <span className="doux petit">({triEcrans.length})</span></h3>
        <ul className="liste-avis">
          {triEcrans.map(([ecran, e]) => (
            <li key={ecran}>
              <div className="ligne entre"><strong>{ecran}</strong>
                <span className="ligne">{(['probleme', 'idee', 'question', 'ok'] as const).filter((t) => e[t].length).map((t) => (
                  <span key={t} className={`pilule ${t === 'probleme' ? 'attente' : t === 'ok' ? 'ok' : 'neutre'}`}>{e[t].length} · {LIBELLES_AVIS[t]}</span>))}</span></div>
              {[...e.probleme, ...e.idee, ...e.question].filter((a) => a.message).map((a) => (
                <p key={a.id} className="petit" style={{ margin: 0 }}><span className="doux">{LIBELLES_AVIS[a.type]} :</span> {a.message} <span className="doux">— {a.prenom}</span></p>))}
            </li>
          ))}
        </ul>
      </>}
    </div>
  )
}
