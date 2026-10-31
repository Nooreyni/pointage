import { useCallback, useEffect, useState } from 'react'
import type { Api, Notif, Profil } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { IcCalendrier, IcCloche, IcEquipe, IcHorloge, IcRh, IcStats } from '../components/Icones'
import Pointer from './Pointer'
import Equipe from './Equipe'
import Alertes from './Alertes'
import Conges from './Conges'
import Rh from './Rh'
import Rapports from './Rapports'

type Onglet = 'pointer' | 'equipe' | 'conges' | 'rh' | 'rapports' | 'alertes'

export default function Espace({ api, onQuitter, onChangerVue }: {
  api: Api; onQuitter: () => void; onChangerVue?: () => void
}) {
  const [profil, setProfil] = useState<Profil | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<Onglet>('pointer')
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  const [menu, setMenu] = useState(false)
  const [aValider, setAValider] = useState(0)

  useEffect(() => {
    api.profil().then(setProfil).catch((e) => setErreur(messageErreur(e)))
  }, [api])

  const chargerNotifs = useCallback(() => { api.notifications().then(setNotifs).catch(() => {}) }, [api])
  useEffect(() => {
    if (!profil) return
    chargerNotifs()
    api.aValider().then((d) => setAValider(d.length)).catch(() => {})
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
  const initiales = (profil.prenom[0] + profil.nom[0]).toUpperCase()
  const onglets: [Onglet, string, () => React.JSX.Element, number][] = [
    ['pointer', 'Pointer', IcHorloge, 0], ['equipe', 'Équipe', IcEquipe, 0], ['conges', 'Congés', IcCalendrier, aValider],
    ...(['rh', 'admin_rh', 'admin'].includes(profil.role) ? [['rh', 'RH', IcRh, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ...(['direction', 'rh', 'admin_rh', 'admin', 'responsable_isp'].includes(profil.role)
      ? [['rapports', 'Rapports', IcStats, 0] as [Onglet, string, () => React.JSX.Element, number]] : []),
    ['alertes', 'Alertes', IcCloche, 0],
  ]

  return (
    <div className="app">
      <header className="entete">
        <div className="marque"><img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />CFB Pointage</div>
        <div className="espace" />
        <button className="cloche" aria-label={`Alertes (${nonLues} non lues)`} onClick={() => setOnglet('alertes')}>
          <IcCloche />{nonLues > 0 && <span className="pastille">{nonLues}</span>}
        </button>
        <div className="menu-compte">
          <button className="avatar" aria-expanded={menu} aria-label={`Compte de ${profil.prenom} ${profil.nom}`}
                  onClick={() => setMenu((m) => !m)}>{initiales}</button>
          {menu && (
            <div className="menu" role="menu">
              <div className="menu-nom"><strong>{profil.prenom} {profil.nom}</strong><span className="doux petit">{profil.service}</span></div>
              <button role="menuitem" onClick={() => { setMenu(false); api.deconnexion(); onQuitter() }}>Se déconnecter</button>
            </div>
          )}
        </div>
      </header>
      {api.mode === 'demo' && (
        <div className="bandeau-demo">Mode démo — données fictives, rien n’est enregistré
          {onChangerVue && <button className="lien-bandeau" onClick={onChangerVue}>
            {profil.role === 'direction' ? 'Voir comme employée' : profil.role === 'rh' ? 'Voir comme direction' : profil.est_chef_service ? 'Voir comme RH' : 'Voir comme chef de service'}</button>}
        </div>
      )}
      {!enLigne && <div className="bandeau-hors-ligne">Hors ligne — tes pointages sont gardés sur l’appareil et envoyés dès le retour du réseau</div>}

      <nav className="nav" aria-label="Navigation principale">
        {onglets.map(([id, libelle, Icone, compte]) => (
          <button key={id} aria-current={onglet === id ? 'page' : undefined} onClick={() => setOnglet(id)}>
            <span className="icone-nav"><Icone />{compte > 0 && <span className="pastille-nav">{compte}</span>}</span>{libelle}
          </button>
        ))}
      </nav>

      {onglet === 'pointer' && <Pointer api={api} profil={profil} enLigne={enLigne} />}
      {onglet === 'conges' && <Conges api={api} profil={profil} />}
      {onglet === 'rh' && <Rh api={api} />}
      {onglet === 'rapports' && <Rapports api={api} profil={profil} />}
      {onglet === 'equipe' && <main className="contenu"><div className="col-principale pile"><Equipe api={api} /></div></main>}
      {onglet === 'alertes' && <main className="contenu"><div className="col-principale pile">
        <Alertes notifs={notifs} onVu={() => api.marquerLu().then(chargerNotifs)} />
      </div></main>}
    </div>
  )
}
