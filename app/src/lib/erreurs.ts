import { supabase } from './supabase'
import paquet from '../../package.json'

// Remontée des erreurs de l'appli vers la base (Réglages › Journal › Erreurs de l'appli) : message technique, écran,
// version, navigateur. Jamais le contenu saisi. Au plus une fois par message et par session ; rien en démo.
const dejaVus = new Set<string>()
export function signalerErreur(e: unknown) {
  if (!supabase || new URLSearchParams(location.search).has('demo')) return
  const message = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500)
  if (!message || dejaVus.has(message) || dejaVus.size > 20) return
  dejaVus.add(message)
  const ecran = document.querySelector('nav.nav [aria-current="page"]')?.textContent?.trim()
    + (document.querySelector('.sous-nav [aria-selected="true"]')?.textContent ? ` › ${document.querySelector('.sous-nav [aria-selected="true"]')!.textContent!.trim()}` : '')
  supabase.rpc('signaler_erreur', { p_message: message, p_ecran: ecran || null, p_version: paquet.version, p_navigateur: navigator.userAgent.slice(0, 160) })
    .then(() => {}, () => {})
}
export function installerRemonteeErreurs() {
  addEventListener('error', (ev) => signalerErreur(ev.error ?? ev.message))
  addEventListener('unhandledrejection', (ev) => signalerErreur(ev.reason))
}
