import { useEffect, useState } from 'react'
import type { Api, Profil } from '../lib/types'
import { messageErreur } from '../lib/supabase'
import TeletravailHabituel from '../components/TeletravailHabituel'
import HoraireHabituel from '../components/HoraireHabituel'
import NotifAppareil from '../components/NotifAppareil'
import AgendaOutlook from '../components/AgendaOutlook'
import DoubleAuth from '../components/DoubleAuth'
import { InstallerAppli } from '../components/Pwa'

const ROLES: Record<Profil['role'], string> = {
  employe: 'Employé·e', rh: 'RH', admin_rh: 'Admin RH', responsable_isp: 'Responsable ISP', direction: 'Direction', admin: 'Admin général',
}

/** Mon compte : mes informations, mes horaires et jours de télétravail habituels, mon mot de passe, mes notifications. */
export default function Compte({ api, profil, onAccueil, onProfilChange }: { api: Api; profil: Profil; onAccueil?: () => void; onProfilChange?: () => void }) {
  const [moyens, setMoyens] = useState<{ motDePasse: boolean; microsoft: boolean } | null>(null)
  const [mdpOuvert, setMdpOuvert] = useState(false)
  useEffect(() => { api.connexion().then(setMoyens).catch(() => setMoyens({ motDePasse: false, microsoft: false })) }, [api])
  const role = profil.est_chef_service && profil.role === 'employe' ? 'Chef de service' : ROLES[profil.role]

  return (
    <main className="contenu">
      <div className="col-principale pile">
        <section className="carte">
          <div className="ligne entre"><h2>Mon compte</h2>
            {onAccueil && <button className="lien petit" onClick={onAccueil}>Refaire le parcours d’accueil</button>}</div>
          <dl className="infos-compte">
            <div><dt>Nom</dt><dd>{profil.prenom} {profil.nom}</dd></div>
            <div><dt>E-mail</dt><dd>{profil.email}</dd></div>
            <div><dt>Service</dt><dd>{profil.service}</dd></div>
            <div><dt>Rôle</dt><dd>{role}</dd></div>
            <div><dt>Régime</dt><dd>{profil.regime ?? '—'}</dd></div>
          </dl>
          <p className="doux petit" style={{ marginBottom: 0 }}>Une info est fausse ? Signale-le à la RH.</p>
        </section>

        <section className="carte" id="mes-horaires">
          <h2>Mes horaires habituels</h2>
          <HoraireHabituel api={api} moi minutesJour={profil.minutes_jour} onEnregistre={onProfilChange} />
        </section>

        <section className="carte" id="mes-jours-tt">
          <h2>Mes jours de télétravail</h2>
          <TeletravailHabituel api={api} personneId={profil.id} moi detaille />
        </section>
      </div>

      <div className="col-laterale pile">
        <NotifAppareil api={api} />
        <InstallerAppli />
        <section className="carte">
          <div className="ligne entre"><h2>Mot de passe</h2>
            {moyens?.motDePasse && !mdpOuvert && <button className="bouton secondaire petit" onClick={() => setMdpOuvert(true)}>Changer</button>}</div>
          {!moyens && <p className="vide">Chargement…</p>}
          {moyens?.motDePasse && !mdpOuvert && <p className="doux petit" style={{ margin: 0 }}>Facultatif : garde celui que la RH t’a donné ou change-le quand tu veux.
            {moyens.microsoft && ' Tu peux aussi te connecter avec Microsoft.'}</p>}
          {moyens?.motDePasse && mdpOuvert && <ChangerMotDePasse api={api} onFermer={() => setMdpOuvert(false)} />}
          {moyens && !moyens.motDePasse && (
            <p className="petit" style={{ marginBottom: 0 }}>Tu te connectes avec ton compte Microsoft : ton mot de passe se change chez Microsoft
              (Office 365). Pour avoir aussi un mot de passe propre à CFB Pointage, demande-le à la RH.</p>
          )}
        </section>
        <section className="carte">
          <h2>Agenda Outlook</h2>
          <AgendaOutlook api={api} />
        </section>
        {['admin', 'admin_rh', 'rh', 'direction'].includes(profil.role) && (
          <section className="carte">
            <h2>Double authentification</h2>
            <DoubleAuth api={api} />
          </section>
        )}
      </div>
    </main>
  )
}

function ChangerMotDePasse({ api, onFermer }: { api: Api; onFermer: () => void }) {
  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirme, setConfirme] = useState('')
  const [voir, setVoir] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null)
  const different = confirme.length > 0 && confirme !== nouveau
  const tropCourt = nouveau.length > 0 && nouveau.length < 8

  async function envoyer(e: React.FormEvent) {
    e.preventDefault()
    if (nouveau.length < 8) return setMessage({ texte: '8 caractères minimum', erreur: true })
    if (nouveau !== confirme) return setMessage({ texte: 'Les deux nouveaux mots de passe ne sont pas identiques', erreur: true })
    setEnCours(true); setMessage(null)
    try {
      await api.changerMotDePasse(actuel, nouveau)
      setActuel(''); setNouveau(''); setConfirme('')
      setMessage({ texte: 'Mot de passe changé ✅ Utilise-le à ta prochaine connexion.' })
    } catch (err) { setMessage({ texte: messageErreur(err), erreur: true }) } finally { setEnCours(false) }
  }

  const type = voir ? 'text' : 'password'
  return (
    <form onSubmit={envoyer} className="form-mdp">
      <label className="champ">Mot de passe actuel
        <input id="mdp-actuel" type={type} value={actuel} onChange={(e) => setActuel(e.target.value)} autoComplete="current-password" required /></label>
      <label className="champ">Nouveau mot de passe
        <input id="mdp-nouveau" type={type} value={nouveau} onChange={(e) => setNouveau(e.target.value)} autoComplete="new-password" required
               aria-invalid={tropCourt} aria-describedby="aide-mdp" /></label>
      <span id="aide-mdp" className={`petit ${tropCourt ? 'negatif' : 'doux'}`}>8 caractères minimum. Astuce : une petite phrase est facile à retenir et difficile à deviner.</span>
      <label className="champ">Confirmer le nouveau
        <input id="mdp-confirme" type={type} value={confirme} onChange={(e) => setConfirme(e.target.value)} autoComplete="new-password" required
               aria-invalid={different} /></label>
      {different && <span className="petit negatif">Pas identique au nouveau mot de passe</span>}
      <label className="case-a-cocher petit"><input type="checkbox" checked={voir} onChange={(e) => setVoir(e.target.checked)} />Afficher les mots de passe</label>
      <div className="actions">
        <button type="button" className="bouton secondaire" onClick={onFermer}>Fermer</button>
        <button className="bouton" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Changer mon mot de passe'}</button>
      </div>
      {message && <p className={`petit ${message.erreur ? 'negatif' : 'positif'}`} role={message.erreur ? 'alert' : 'status'}>{message.texte}</p>}
    </form>
  )
}
