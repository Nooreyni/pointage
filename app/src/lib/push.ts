// Notifications push sur l'appareil : abonnement / désabonnement (clé publique lue dans la configuration serveur)
import type { Api } from './types'

export type EtatPush = 'demo' | 'indisponible' | 'non_configure' | 'refuse' | 'inactif' | 'actif'

const b64 = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')
function cleServeur(b64url: string): Uint8Array<ArrayBuffer> {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

const pushSupporte = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function enregistrement(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupporte()) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function etatPush(api: Api): Promise<EtatPush> {
  if (api.mode === 'demo') return 'demo'
  if (!pushSupporte()) return 'indisponible'
  const reg = await enregistrement()
  if (!reg) return 'indisponible'
  const cfg = await api.configPublique().catch(() => ({ vapid_public: null }))
  if (!cfg.vapid_public) return 'non_configure'
  if (Notification.permission === 'denied') return 'refuse'
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return 'inactif'
  // Resynchronise (abonnement renouvelé par le navigateur, ou appareil repris par une autre personne)
  await api.enregistrerPush(sub.endpoint, b64(sub.getKey('p256dh')), b64(sub.getKey('auth'))).catch(() => {})
  return 'actif'
}

export async function activerPush(api: Api): Promise<EtatPush> {
  const reg = await enregistrement()
  const cfg = await api.configPublique()
  if (!reg || !cfg.vapid_public) return 'non_configure'
  if (await Notification.requestPermission() !== 'granted') return 'refuse'
  let sub = await reg.pushManager.getSubscription()
  // Clé serveur changée (réinstallation) : on se réabonne
  if (sub && b64(sub.options.applicationServerKey) !== cfg.vapid_public) { await sub.unsubscribe(); sub = null }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleServeur(cfg.vapid_public) })
  await api.enregistrerPush(sub.endpoint, b64(sub.getKey('p256dh')), b64(sub.getKey('auth')))
  return 'actif'
}

/** Désactive sur cet appareil (aussi appelé à la déconnexion : appareil partagé). */
export async function desactiverPush(api: Api): Promise<void> {
  const sub = await (await enregistrement())?.pushManager.getSubscription()
  if (!sub) return
  await api.retirerPush(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}
