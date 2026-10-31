import { useState } from 'react'
import { messageErreur, supabase } from '../lib/supabase'
import { IcMicrosoft } from '../components/Icones'

const COMPTES_DEV = [
  ['admin.it@cfb.test', 'Admin général (tous les droits)'],
  ['sofia.janssens@cfb.test', 'Sofia — employée (Administration)'],
  ['yanis.peeters@cfb.test', 'Yanis — employé temps partiel'],
  ['marc.dupont@cfb.test', 'Marc — chef de service'],
  ['jordan.kabongo@cfb.test', 'Jordan — ISP'],
  ['nadia.benali@cfb.test', 'Nadia — RH'],
  ['ines.leroy@cfb.test', 'Inès — admin RH'],
  ['claire.lambert@cfb.test', 'Claire — direction'],
]

export default function Connexion({ onDemo }: { onDemo: () => void }) {
  const [erreur, setErreur] = useState<string | null>(null)
  const [email, setEmail] = useState(COMPTES_DEV[0][0])
  const [mdp, setMdp] = useState('')
  const [enCours, setEnCours] = useState(false)

  async function microsoft() {
    setErreur(null)
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'azure', options: { scopes: 'email openid profile', redirectTo: location.origin },
    })
    if (error) setErreur('Connexion Microsoft pas encore activée (enregistrement Entra ID à faire).')
  }

  async function dev(e: React.FormEvent) {
    e.preventDefault()
    setEnCours(true); setErreur(null)
    const { error } = await supabase!.auth.signInWithPassword({ email, password: mdp })
    setEnCours(false)
    if (error) setErreur(messageErreur(error))
  }

  return (
    <div className="connexion">
      <div className="carte">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />
        <h1>CFB Pointage</h1>
        <p className="doux">Centre Familial de Bruxelles</p>

        {supabase && (
          <button className="bouton-ms" onClick={microsoft}><IcMicrosoft /> Se connecter avec Microsoft</button>
        )}

        {supabase && import.meta.env.VITE_CONNEXION_DEV === '1' && (
          <>
            <div className="separateur">Comptes fictifs (développement)</div>
            <form onSubmit={dev}>
              <label className="champ">Compte
                <select value={email} onChange={(e) => setEmail(e.target.value)}>
                  {COMPTES_DEV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="champ">Mot de passe
                <input type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} autoComplete="current-password" required />
              </label>
              <button className="bouton" disabled={enCours}>{enCours ? 'Connexion…' : 'Se connecter'}</button>
            </form>
          </>
        )}

        {import.meta.env.VITE_MODE_DEMO === '1' && (
          <p style={{ marginTop: 18 }}><button className="lien" onClick={onDemo}>Essayer en mode démo (sans serveur)</button></p>
        )}
        {erreur && <p className="negatif petit" role="alert">{erreur}</p>}
      </div>
    </div>
  )
}
