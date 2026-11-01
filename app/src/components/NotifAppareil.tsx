import { useEffect, useState } from 'react'
import { IcCloche } from './Icones'
import type { Api } from '../lib/types'
import { activerPush, desactiverPush, etatPush, type EtatPush } from '../lib/push'
import { messageErreur } from '../lib/supabase'

const TEXTES: Record<EtatPush, string> = {
  demo: 'En démo, rien n’est envoyé. Dans l’appli réelle, chacun active ici les rappels sur son téléphone ou son PC.',
  indisponible: 'Ce navigateur ne gère pas les notifications. Sur iPhone : ajoute d’abord l’appli à l’écran d’accueil.',
  non_configure: 'Les notifications ne sont pas encore activées sur ce serveur (réglage de l’IT).',
  refuse: 'Notifications bloquées pour ce site. Autorise-les dans les réglages du navigateur, puis réessaie.',
  inactif: 'Reçois les rappels d’oubli de pointage et les réponses à tes congés, même appli fermée.',
  actif: 'Activées sur cet appareil.',
}

/** Carte (Alertes) ou bandeau compact (Pointer) pour activer les notifications push sur l'appareil. */
export default function NotifAppareil({ api, compact = false }: { api: Api; compact?: boolean }) {
  const [etat, setEtat] = useState<EtatPush | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [masque, setMasque] = useState(() => { try { return localStorage.getItem('cfb.push-bandeau') === 'masque' } catch { return false } })

  useEffect(() => { etatPush(api).then(setEtat).catch(() => setEtat('indisponible')) }, [api])

  async function basculer() {
    setEnCours(true); setErreur(null)
    try {
      if (etat === 'actif') { await desactiverPush(api); setEtat('inactif') } else setEtat(await activerPush(api))
    } catch (e) { setErreur(messageErreur(e)) } finally { setEnCours(false) }
  }

  if (!etat) return null
  if (compact) {
    if (etat !== 'inactif' || masque) return null
    return (
      <section className="carte bandeau-push" aria-label="Notifications">
        <span className="pictogramme-push"><IcCloche size={20} /></span>
        <span className="texte-ligne"><strong>Active les rappels</strong><span className="doux petit"> pour ne plus oublier de pointer.</span></span>
        <button className="bouton petit" disabled={enCours} onClick={basculer}>Activer</button>
        <button className="lien petit" aria-label="Plus tard" onClick={() => { setMasque(true); try { localStorage.setItem('cfb.push-bandeau', 'masque') } catch { /* */ } }}>Plus tard</button>
      </section>
    )
  }
  return (
    <section className="carte">
      <div className="ligne entre"><h2>Notifications</h2>
        {(etat === 'actif' || etat === 'inactif') && (
          <button className="interrupteur" role="switch" aria-checked={etat === 'actif'} aria-label="Notifications sur cet appareil"
                  disabled={enCours} onClick={basculer}><span /></button>
        )}</div>
      <p className="doux petit" style={{ margin: 0 }}>{TEXTES[etat]}</p>
      {erreur && <p className="negatif petit" style={{ marginBottom: 0 }}>{erreur}</p>}
    </section>
  )
}
