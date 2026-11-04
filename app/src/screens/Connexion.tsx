import { useState } from 'react'
import { supabase, traduireAuth } from '../lib/supabase'
import { IcMicrosoft } from '../components/Icones'

const COMPTES_DEV = [
  ['adminit.cfb@centrefamilial.be', 'Admin général (tous les droits)'],
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
  const dev = import.meta.env.VITE_CONNEXION_DEV === '1'
  const [email, setEmail] = useState(dev ? COMPTES_DEV[0][0] : '')
  const [voir, setVoir] = useState(false)
  const [mdp, setMdp] = useState('')
  const [enCours, setEnCours] = useState(false)

  async function microsoft() {
    setErreur(null)
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'azure', options: { scopes: 'email openid profile', redirectTo: location.origin },
    })
    if (error) setErreur('Connexion Microsoft pas encore activée (enregistrement Entra ID à faire).')
  }

  async function seConnecter(e: React.FormEvent) {
    e.preventDefault()
    setEnCours(true); setErreur(null)
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: mdp })
    setEnCours(false)
    if (error) setErreur(traduireAuth(error.message))
  }

  return (
    <div className="connexion">
      <div className="carte">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />
        <h1>CFB Pointage</h1>
        <p className="doux">Centre Familial de Bruxelles</p>

        {supabase && (
          <form onSubmit={seConnecter} className="form-connexion">
            {dev && (
              <label className="champ">Compte fictif (développement)
                <select value={email} onChange={(e) => setEmail(e.target.value)}>
                  {COMPTES_DEV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
            <label className="champ">E-mail professionnel
              <input id="cx-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required
                     placeholder="prenom.nom@…" inputMode="email" /></label>
            <label className="champ">Mot de passe
              <span className="champ-mdp">
                <input id="cx-mdp" type={voir ? 'text' : 'password'} value={mdp} onChange={(e) => setMdp(e.target.value)} autoComplete="current-password" required />
                <button type="button" className="lien petit" onClick={() => setVoir((v) => !v)} aria-pressed={voir}>{voir ? 'Masquer' : 'Afficher'}</button>
              </span></label>
            <button className="bouton" disabled={enCours}>{enCours ? 'Connexion…' : 'Se connecter'}</button>
            <p className="doux petit" style={{ margin: 0 }}>Mot de passe oublié ? Demande à la RH de t’en générer un nouveau.</p>
          </form>
        )}

        {supabase && <>
          <div className="separateur">ou</div>
          <button className="bouton-ms" onClick={microsoft}><IcMicrosoft /> Se connecter avec Microsoft</button>
        </>}

        {import.meta.env.VITE_MODE_DEMO === '1' && (
          <p style={{ marginTop: 18 }}><button className="lien" onClick={onDemo}>Essayer en mode démo (sans serveur)</button></p>
        )}
        {erreur && <p className="negatif petit" role="alert">{erreur}</p>}
      </div>
    </div>
  )
}
