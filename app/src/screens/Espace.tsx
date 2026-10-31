import { useCallback, useEffect, useState } from 'react'
import type { Api, Notif, Profil } from '../lib/types'
import type { Persona } from '../lib/demo'
import { messageErreur } from '../lib/supabase'
import { definirProprietaire, enAttente, synchroniser } from '../lib/file'
import { IcAdmin, IcCalendrier, IcCloche, IcEquipe, IcHorloge, IcRh, IcStats } from '../components/Icones'
import Pointer from './Pointer'
import Equipe from './Equipe'
import Alertes, { type Destination } from './Alertes'
import Conges, { type VueConges } from './Conges'
import Rh from './Rh'
import Rapports from './Rapports'
import Admin from './Admin'

type Onglet = 'pointer' | 'equipe' | 'conges' | 'rh' | 'rapports' | 'admin' | 'alertes'

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
  const [onglet, setOnglet] = useState<Onglet>('pointer')
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  const [menu, setMenu] = useState(false)
  const [attenteDeco, setAttenteDeco] = useState(0)   // pointages pas encore envoyés au moment de se déconnecter
  const [aValider, setAValider] = useState(0)
  const [nbAnomalies, setNbAnomalies] = useState(0)
  const [vueConges, setVueConges] = useState<VueConges>('mes')

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
  const quitter = () => { definirProprietaire(null); api.deconnexion(); onQuitter() }
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
    ['pointer', 'Pointer', IcHorloge, 0], ['equipe', 'Équipe', IcEquipe, 0], ['conges', 'Congés', IcCalendrier, aValider],
    ...(['rh', 'admin_rh', 'admin'].includes(profil.role) ? [['rh', 'RH', IcRh, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ...(['direction', 'rh', 'admin_rh', 'admin', 'responsable_isp'].includes(profil.role)
      ? [['rapports', 'Rapports', IcStats, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ...(['admin', 'admin_rh'].includes(profil.role) ? [['admin', 'Admin', IcAdmin, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ['alertes', 'Alertes', IcCloche, 0],
  ]

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
          <button key={id} aria-current={onglet === id ? 'page' : undefined} onClick={() => aller(id)}>
            <span className="icone-nav"><Icone />{compte > 0 && <span className="pastille-nav">{compte}</span>}</span>{libelle}
          </button>
        ))}
      </nav>

      {attenteDeco > 0 && (
        <div className="voile" role="dialog" aria-modal="true" aria-labelledby="titre-deco" onClick={() => setAttenteDeco(0)}>
          <div className="fenetre" onClick={(e) => e.stopPropagation()}>
            <h2 id="titre-deco">{attenteDeco} pointage(s) pas encore envoyé(s)</h2>
            <p className="petit">Tu es hors ligne. Ils restent gardés sur cet appareil <strong>à ton nom uniquement</strong> et seront envoyés
              à ta prochaine connexion ici. Une autre personne qui se connecte sur cet appareil ne les enverra pas.</p>
            <div className="actions">
              <button className="bouton secondaire" onClick={() => setAttenteDeco(0)}>Rester connecté</button>
              <button className="bouton" onClick={() => { setAttenteDeco(0); quitter() }}>Se déconnecter</button>
            </div>
          </div>
        </div>
      )}
      {onglet === 'pointer' && <Pointer api={api} profil={profil} enLigne={enLigne} onVoirEquipe={() => aller('equipe')} />}
      {onglet === 'conges' && <Conges api={api} profil={profil} vueInitiale={vueConges} onCompteValider={setAValider} />}
      {onglet === 'rh' && <Rh api={api} />}
      {onglet === 'rapports' && <Rapports api={api} profil={profil} />}
      {onglet === 'admin' && <Admin api={api} profil={profil} />}
      {onglet === 'equipe' && <Equipe api={api} profil={profil} />}
      {onglet === 'alertes' && <Alertes notifs={notifs} onVu={marquerLu} onAller={allerVers} aFaire={{ anomalies: nbAnomalies, aValider }} />}
    </div>
  )
}
