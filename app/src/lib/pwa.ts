// PWA : inscription du service worker, nouvelle version disponible, installation sur l'appareil.
// Les composants s'abonnent à `etatPwa` (MiseAJour, Installer) ; aucune dépendance externe.
type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export type EtatPwa = { majDisponible: boolean; installable: boolean; installee: boolean; ios: boolean }

let invite: BeforeInstallPrompt | null = null
let enAttente: ServiceWorker | null = null
let majDemandee = false   // la page ne se recharge que si la personne a choisi « Mettre à jour » (pas à la 1re installation)
const abonnes = new Set<(e: EtatPwa) => void>()

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
// iPhone / iPad (y compris iPad « bureau ») : pas d'invite d'installation, il faut passer par Partager
const estIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function etatPwa(): EtatPwa {
  return { majDisponible: !!enAttente, installable: !!invite, installee: standalone(), ios: estIos() && !standalone() }
}
const prevenir = () => { const e = etatPwa(); abonnes.forEach((f) => f(e)) }
export function suivrePwa(f: (e: EtatPwa) => void): () => void { abonnes.add(f); f(etatPwa()); return () => abonnes.delete(f) }

/** Demande au navigateur d'installer l'appli (Android, Chrome, Edge). Renvoie true si acceptée. */
export async function installer(): Promise<boolean> {
  if (!invite) return false
  await invite.prompt()
  const { outcome } = await invite.userChoice
  invite = null; prevenir()
  return outcome === 'accepted'
}

/** Active la nouvelle version : le service worker en attente prend la main, la page se recharge une fois. */
export function mettreAJour() {
  if (!enAttente) return location.reload()
  majDemandee = true
  enAttente.postMessage('METTRE_A_JOUR')
}

export function demarrerPwa() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite = e as BeforeInstallPrompt; prevenir() })
  addEventListener('appinstalled', () => { invite = null; prevenir() })
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  let recharge = false
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (majDemandee && !recharge) { recharge = true; location.reload() } })

  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    const surveiller = (sw: ServiceWorker | null) => {
      if (!sw) return
      sw.addEventListener('statechange', () => {
        // Installée alors qu'une version tourne déjà : c'est une mise à jour (la 1re installation ne demande rien)
        if (sw.state === 'installed' && navigator.serviceWorker.controller) { enAttente = sw; prevenir() }
      })
    }
    if (reg.waiting && navigator.serviceWorker.controller) { enAttente = reg.waiting; prevenir() }
    surveiller(reg.installing)
    reg.addEventListener('updatefound', () => surveiller(reg.installing))
    // Vérifie s'il y a une nouvelle version : au retour sur l'appli et toutes les heures
    const verifier = () => { if (navigator.onLine) reg.update().catch(() => {}) }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier() })
    setInterval(verifier, 60 * 60 * 1000)
  }).catch(() => { /* PWA facultative : l'appli marche sans */ })
}
