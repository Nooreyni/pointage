import { useEffect, useState } from 'react'
import { etatPwa, installer, mettreAJour, suivrePwa, type EtatPwa } from '../lib/pwa'

function useEtatPwa(): EtatPwa {
  const [e, setE] = useState(etatPwa)
  useEffect(() => suivrePwa(setE), [])
  return e
}

/** Nouvelle version déployée : proposée, jamais imposée en plein travail. Les pointages hors ligne sont conservés. */
export function MiseAJour() {
  const { majDisponible } = useEtatPwa()
  const [enCours, setEnCours] = useState(false)
  if (!majDisponible) return null
  return (
    <div className="bandeau-maj" role="status">
      <span>Nouvelle version de l’appli disponible</span>
      <button className="bouton petit" disabled={enCours} onClick={() => { setEnCours(true); mettreAJour() }}>{enCours ? 'Mise à jour…' : 'Mettre à jour'}</button>
    </div>
  )
}

const ETAPES_IOS = ['Touche le bouton Partager (carré avec une flèche) en bas de Safari', 'Choisis « Sur l’écran d’accueil »', 'Ouvre ensuite CFB Pointage depuis l’icône']

/** Mon compte : installer l'appli sur cet appareil (ou comment faire sur iPhone). */
export function InstallerAppli() {
  const e = useEtatPwa()
  return (
    <section className="carte">
      <h2>Appli sur cet appareil</h2>
      {e.installee ? <p className="positif" style={{ marginBottom: 0 }}>Installée : tu l’ouvres depuis son icône, comme une appli.</p>
        : e.installable ? <>
            <p className="doux petit">Une icône sur l’écran d’accueil, l’appli en plein écran, et les rappels de pointage.</p>
            <button className="bouton" onClick={() => installer()}>Installer l’appli</button>
          </>
        : e.ios ? <>
            <p className="doux petit">Sur iPhone, l’installation est nécessaire pour recevoir les rappels.</p>
            <ol className="etapes-ios">{ETAPES_IOS.map((t) => <li key={t}>{t}</li>)}</ol>
          </>
        : <p className="doux petit" style={{ marginBottom: 0 }}>Menu du navigateur › « Installer CFB Pointage » ou « Ajouter à l’écran d’accueil ».
            Sur un PC partagé, inutile : le site suffit.</p>}
    </section>
  )
}

const CLE = 'cfb-invite-installation'
const masquee = () => { try { return Number(localStorage.getItem(CLE) ?? 0) > Date.now() } catch { return false } }

/** Écran Pointer, sur téléphone, appli pas encore installée : une invitation discrète (« Plus tard » = 30 jours). */
export function InviteInstallation() {
  const e = useEtatPwa()
  const [cachee, setCachee] = useState(masquee)
  const mobile = matchMedia('(max-width: 899px) and (pointer: coarse)').matches
  if (cachee || e.installee || !mobile || !(e.installable || e.ios)) return null
  const plusTard = () => { try { localStorage.setItem(CLE, String(Date.now() + 30 * 86_400_000)) } catch { /* navigation privée */ } setCachee(true) }
  return (
    <section className="carte invite-installation">
      <p style={{ margin: 0 }}><strong>Installe l’appli sur ton téléphone</strong><br />
        <span className="doux petit">Un appui sur l’icône pour pointer{e.ios ? ', et les rappels (obligatoire sur iPhone)' : ', et les rappels'}.</span></p>
      {e.ios ? <ol className="etapes-ios">{ETAPES_IOS.slice(0, 2).map((t) => <li key={t}>{t}</li>)}</ol> : null}
      <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        {e.installable && <button className="bouton petit" onClick={() => installer()}>Installer</button>}
        <button className="bouton secondaire petit" onClick={plusTard}>Plus tard</button>
      </div>
    </section>
  )
}
