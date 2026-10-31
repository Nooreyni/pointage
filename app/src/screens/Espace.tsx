import { useCallback, useEffect, useState } from 'react'
import type { Api, Notif, Profil } from '../lib/types'
import type { Persona } from '../lib/demo'
import { messageErreur } from '../lib/supabase'
import { definirProprietaire, enAttente, synchroniser } from '../lib/file'
import { desactiverPush } from '../lib/push'
import { IcAdmin, IcCalendrier, IcCloche, IcEquipe, IcHeures, IcHorloge, IcRh, IcStats } from '../components/Icones'
import Pointer from './Pointer'
import Equipe from './Equipe'
import Alertes, { type Destination } from './Alertes'
import Conges, { type VueConges } from './Conges'
import Rh from './Rh'
import Rapports from './Rapports'
import Admin from './Admin'
import Heures from './Heures'
import { useDialogue } from '../components/useDialogue'

type Onglet = 'pointer' | 'heures' | 'equipe' | 'conges' | 'rh' | 'rapports' | 'admin' | 'alertes'

const VUES_DEMO: [Persona, string, string][] = [
  ['employe', 'Employée', 'Pointe, demande ses congés'],
  ['chef', 'Chef de service', 'Valide son équipe'],
  ['rh', 'RH', 'Anomalies, constats, clôture'],
  ['direction', 'Direction', 'Tous les services, statistiques'],
  ['admin', 'Admin général', 'Tous les droits + paramètres'],
]
const ROLES: Record<Profil['role'], string> = {
  employe: 'Employé·e', rh: 'RH', admin_rh: 'Admin RH', responsable_isp: 'Responsable ISP', direction: 'Direction', admin: 'Admin général',
}

export default function Espace({ api, onQuitter, vueDemo }: {
  api: Api; onQuitter: () => void; vueDemo?: { persona: Persona; choisir: (p: Persona) => void }
}) {
  const [profil, setProfil] = useState<Profil | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<Onglet>(() => {
    const demande = new URLSearchParams(location.search).get('onglet')
    return (['pointer', 'heures', 'equipe', 'conges', 'rh', 'rapports', 'admin', 'alertes'] as string[]).includes(demande ?? '') ? demande as Onglet : 'pointer'
  })
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  const [menu, setMenu] = useState(false)
  const [attenteDeco, setAttenteDeco] = useState(0)   // pointages pas encore envoyés au moment de se déconnecter
  const [aValider, setAValider] = useState(0)
  const [nbAnomalies, setNbAnomalies] = useState(0)
  const [vueConges, setVueConges] = useState<VueConges>('mes')
  const [ficheDe, setFicheDe] = useState<string | null>(null)   // fiche de temps ouverte depuis Équipe

  useEffect(() => {
    api.profil().then((p) => { definirProprietaire(p.id); setProfil(p) }).catch((e) => setErreur(messageErreur(e)))
    return () => definirProprietaire(null)
  }, [api])

  const chargerNotifs = useCallback(() => { api.notifications().then(setNotifs).catch(() => {}) }, [api])
  const marquerLu = useCallback(() => { api.marquerLu().then(chargerNotifs).catch(() => {}) }, [api, chargerNotifs])
  useEffect(() => {
    if (!profil) return
    chargerNotifs()
    api.aValider().then((d) => setAValider(d.length)).catch(() => {})
    api.anomalies().then((a) => setNbAnomalies(a.filter((x) => x.code !== 'semaine_max').length)).catch(() => {})
    const t = setInterval(chargerNotifs, 60_000)
    return () => clearInterval(t)
  }, [profil, chargerNotifs])

  useEffect(() => {   // menu du compte : Échap ou clic ailleurs le ferme
    if (!menu) return
    const clavier = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    const clic = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu-compte')) setMenu(false) }
    document.addEventListener('keydown', clavier); document.addEventListener('click', clic)
    return () => { document.removeEventListener('keydown', clavier); document.removeEventListener('click', clic) }
  }, [menu])

  useEffect(() => {   // retire ?onglet=… de l'adresse une fois lu
    const u = new URL(location.href)
    if (u.searchParams.has('onglet')) { u.searchParams.delete('onglet'); history.replaceState(null, '', u) }
  }, [])

  useEffect(() => {
    const maj = () => setEnLigne(navigator.onLine)
    addEventListener('online', maj); addEventListener('offline', maj)
    return () => { removeEventListener('online', maj); removeEventListener('offline', maj) }
  }, [])

  if (erreur) {
    return (
      <div className="connexion"><div className="carte">
        <h1>Accès impossible</h1><p>{erreur}</p>
        <button className="bouton secondaire" onClick={onQuitter}>Se déconnecter</button>
      </div></div>
    )
  }
  if (!profil) return <div className="squelette">Chargement…</div>

  const nonLues = notifs.filter((n) => !n.lu_le).length
  // Appareil partagé : on coupe les notifications de cette personne avant de partir
  const quitter = async () => { definirProprietaire(null); await desactiverPush(api).catch(() => {}); api.deconnexion(); onQuitter() }
  async function seDeconnecter() {
    setMenu(false)
    if (enAttente().length && navigator.onLine) await synchroniser(api).catch(() => 0)
    const reste = enAttente().length
    if (reste) setAttenteDeco(reste); else quitter()
  }
  const aller = (o: Onglet, vc: VueConges = 'mes') => { setVueConges(vc); setOnglet(o); window.scrollTo({ top: 0 }) }
  const allerVers = (d: Destination) => (d === 'conges-valider' ? aller('conges', 'valider') : aller(d))
  const libelleRole = profil.est_chef_service && profil.role === 'employe' ? 'Chef de service' : ROLES[profil.role]
  const initiales = (profil.prenom[0] + profil.nom[0]).toUpperCase()
  const onglets: [Onglet, string, () => React.JSX.Element, number][] = [
    ['pointer', 'Pointer', IcHorloge, 0], ['heures', 'Heures', IcHeures, 0], ['equipe', 'Équipe', IcEquipe, 0], ['conges', 'Congés', IcCalendrier, aValider],
    ...(['rh', 'admin_rh', 'admin'].includes(profil.role) ? [['rh', 'RH', IcRh, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ...(['direction', 'rh', 'admin_rh', 'admin', 'responsable_isp'].includes(profil.role)
      ? [['rapports', 'Rapports', IcStats, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ...(['admin', 'admin_rh'].includes(profil.role) ? [['admin', 'Admin', IcAdmin, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ['alertes', 'Alertes', IcCloche, 0],
  ]
  // Onglet demandé (lien d'une notification) mais non autorisé pour ce rôle → Pointer
  const actif: Onglet = onglets.some(([id]) => id === onglet) ? onglet : 'pointer'

  return (
    <div className="app">
      <header className="entete">
        <div className="marque"><img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />CFB Pointage</div>
        <div className="espace" />
        <span className="badge-role" title="Ton rôle dans l’application">{libelleRole}</span>
        <button className="cloche" aria-label={`Alertes (${nonLues} non lues)`} onClick={() => aller('alertes')}>
          <IcCloche />{nonLues > 0 && <span className="pastille">{nonLues}</span>}
        </button>
        <div className="menu-compte">
          <button className="avatar" aria-expanded={menu} aria-label={`Compte de ${profil.prenom} ${profil.nom}`}
                  onClick={() => setMenu((m) => !m)}>{initiales}</button>
          {menu && (
            <div className="menu" role="menu">
              <div className="menu-nom"><strong>{profil.prenom} {profil.nom}</strong><span className="doux petit">{libelleRole} · {profil.service}</span></div>
              <button role="menuitem" onClick={seDeconnecter}>Se déconnecter</button>
            </div>
          )}
        </div>
      </header>
      {api.mode === 'demo' && (
        <div className="barre-demo">
          <span className="etiquette-demo"><b>Démo</b> données fictives, rien n’est enregistré</span>
          {vueDemo && (
            <div className="vues-demo" role="group" aria-label="Voir l’application comme">
              <span className="doux petit">Voir comme :</span>
              {VUES_DEMO.map(([id, libelle, aide]) => (
                <button key={id} aria-pressed={vueDemo.persona === id} title={aide} onClick={() => vueDemo.choisir(id)}>{libelle}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {!enLigne && <div className="bandeau-hors-ligne">Hors ligne — tes pointages sont gardés sur l’appareil et envoyés dès le retour du réseau</div>}

      <nav className="nav" aria-label="Navigation principale">
        {onglets.map(([id, libelle, Icone, compte]) => (
          <button key={id} aria-current={actif === id ? 'page' : undefined} onClick={() => aller(id)}>
            <span className="icone-nav"><Icone />{compte > 0 && <span className="pastille-nav">{compte}</span>}</span>{libelle}
          </button>
        ))}
      </nav>

      {attenteDeco > 0 && <ConfirmerDeconnexion n={attenteDeco} onRester={() => setAttenteDeco(0)} onQuitter={() => { setAttenteDeco(0); quitter() }} />}
      {actif === 'pointer' && <Pointer api={api} profil={profil} enLigne={enLigne} onVoirEquipe={() => aller('equipe')} onVoirMois={() => { setFicheDe(null); aller('heures') }} />}
      {actif === 'conges' && <Conges api={api} profil={profil} vueInitiale={vueConges} onCompteValider={setAValider} />}
      {actif === 'rh' && <Rh api={api} />}
      {actif === 'rapports' && <Rapports api={api} profil={profil} />}
      {actif === 'admin' && <Admin api={api} profil={profil} />}
      {actif === 'heures' && <Heures api={api} profil={profil} personneInitiale={ficheDe} />}
      {actif === 'equipe' && <Equipe api={api} profil={profil} onOuvrirFiche={(id) => { setFicheDe(id); aller('heures') }} />}
      {actif === 'alertes' && <Alertes api={api} notifs={notifs} onVu={marquerLu} onAller={allerVers} aFaire={{ anomalies: nbAnomalies, aValider }} />}
    </div>
  )
}

function ConfirmerDeconnexion({ n, onRester, onQuitter }: { n: number; onRester: () => void; onQuitter: () => void }) {
  const ref = useDialogue<HTMLDivElement>(onRester)
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-deco" onClick={onRester}>
      <div className="fenetre" ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 id="titre-deco">{n} pointage(s) pas encore envoyé(s)</h2>
        <p className="petit">Tu es hors ligne. Ils restent gardés sur cet appareil <strong>à ton nom uniquement</strong> et seront envoyés
          à ta prochaine connexion ici. Une autre personne qui se connecte sur cet appareil ne les enverra pas.</p>
        <div className="actions">
          <button className="bouton secondaire" onClick={onRester}>Rester connecté</button>
          <button className="bouton" onClick={onQuitter}>Se déconnecter</button>
        </div>
      </div>
    </div>
  )
}
