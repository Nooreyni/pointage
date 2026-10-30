import { useCallback, useEffect, useState } from 'react'
import type { Api, Notif, Profil } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import { IcCalendrier, IcCloche, IcEquipe, IcHorloge } from '../components/Icones'
import Pointer from './Pointer'
import Equipe from './Equipe'
import Alertes from './Alertes'

type Onglet = 'pointer' | 'equipe' | 'alertes'

export default function Espace({ api, onQuitter }: { api: Api; onQuitter: () => void }) {
  const [profil, setProfil] = useState<Profil | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<Onglet>('pointer')
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [enLigne, setEnLigne] = useState(navigator.onLine)

  useEffect(() => {
    api.profil().then(setProfil).catch((e) => setErreur(messageErreur(e)))
  }, [api])

  const chargerNotifs = useCallback(() => { api.notifications().then(setNotifs).catch(() => {}) }, [api])
  useEffect(() => {
    if (!profil) return
    chargerNotifs()
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
  const onglets: [Onglet | 'demandes', string, () => React.JSX.Element][] = [
    ['pointer', 'Pointer', IcHorloge], ['equipe', 'Équipe', IcEquipe], ['demandes', 'Congés', IcCalendrier], ['alertes', 'Alertes', IcCloche],
  ]

  return (
    <div className="app">
      <header className="entete">
        <div className="marque"><img src="/icons/icon.svg" alt="" />CFB Pointage</div>
        <div className="espace" />
        <button className="cloche" aria-label={`Alertes (${nonLues} non lues)`} onClick={() => setOnglet('alertes')}>
          <IcCloche />{nonLues > 0 && <span className="pastille">{nonLues}</span>}
        </button>
        <button className="avatar" title={`${profil.prenom} ${profil.nom} — se déconnecter`}
                onClick={() => { if (confirmerDeconnexion()) { api.deconnexion(); onQuitter() } }}>{initiales}</button>
      </header>
      {api.mode === 'demo' && <div className="bandeau-demo">Mode démo — données fictives, rien n’est enregistré</div>}
      {!enLigne && <div className="bandeau-hors-ligne">Hors ligne — tes pointages sont gardés sur l’appareil et envoyés dès le retour du réseau</div>}

      <nav className="nav" aria-label="Navigation principale">
        {onglets.map(([id, libelle, Icone]) => (
          <button key={id} aria-current={onglet === id ? 'page' : undefined} disabled={id === 'demandes'}
                  title={id === 'demandes' ? 'Bientôt disponible' : undefined}
                  onClick={() => id !== 'demandes' && setOnglet(id)}>
            <Icone />{libelle}
          </button>
        ))}
      </nav>

      {onglet === 'pointer' && <Pointer api={api} profil={profil} enLigne={enLigne} />}
      {onglet === 'equipe' && <main className="contenu"><div className="col-principale pile"><Equipe api={api} /></div></main>}
      {onglet === 'alertes' && <main className="contenu"><div className="col-principale pile">
        <Alertes notifs={notifs} onVu={() => api.marquerLu().then(chargerNotifs)} />
      </div></main>}
    </div>
  )
}

function confirmerDeconnexion(): boolean {
  // Pas de boîte de dialogue bloquante : simple confirmation native, acceptable ici (action rare)
  return window.confirm('Se déconnecter de CFB Pointage ?')
}
