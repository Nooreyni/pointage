// CFB Pointage — service worker : appli installable, tous les écrans disponibles hors ligne, mises à jour sans casse.
// VERSION et PRECACHE sont remplis au build (vite.config.ts › cfb-precache-pwa) : ne pas modifier ces deux lignes à la main.
const VERSION = '__VERSION__'
const PRECACHE = [/* __PRECACHE__ */]
const CACHE = `cfb-pointage-${VERSION}`
// Chemins relatifs à l'emplacement de l'appli (racine d'un domaine ou sous-dossier d'un serveur interne)
const ACCUEIL = new URL('./index.html', self.registration.scope).href

// Installation : tout l'écran est mis en cache d'avance (un écran jamais ouvert marche aussi hors ligne).
// La nouvelle version attend : l'appli propose « Mettre à jour » (pas de changement en plein travail).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.length ? PRECACHE : ['./', './index.html'])))
})

self.addEventListener('message', (e) => {
  if (e.data === 'METTRE_A_JOUR') self.skipWaiting()
  if (e.data === 'VERSION' && e.ports[0]) e.ports[0].postMessage(VERSION)
})

// Activation : on ne garde que le cache de cette version
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c.startsWith('cfb-pointage-') && c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  // API Supabase et autres origines : jamais en cache (données personnelles)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Pages : réseau d'abord (version à jour), sinon l'écran mis en cache (hors ligne)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(ACCUEIL, { ignoreSearch: true, ignoreVary: true })))
    return
  }
  // Fichiers versionnés (assets/…-empreinte.js), icônes, polices : cache d'abord, complété à la volée
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((enCache) => enCache || fetch(req).then((rep) => {
      if (rep.ok && url.pathname.includes('/assets/')) { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(req, copie)) }
      return rep
    })),
  )
})

// Notifications push (envoyées par le service d'envoi ; message chiffré de bout en bout)
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { corps: e.data ? e.data.text() : '' } }
  const icone = new URL('icons/icon-192.png', self.registration.scope).href
  e.waitUntil(self.registration.showNotification(d.titre || 'CFB Pointage', {
    body: d.corps || '', icon: icone, badge: icone, tag: d.tag, renotify: Boolean(d.tag),
    data: { lien: new URL(d.lien || './?onglet=alertes', self.registration.scope).href },
  }))
})

// Clic : réutilise une fenêtre de l'appli déjà ouverte, sinon en ouvre une
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const cible = (e.notification.data && e.notification.data.lien) || self.registration.scope
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
    const ouverte = fenetres.find((f) => f.url.startsWith(self.registration.scope))
    if (ouverte) return ouverte.navigate(cible).then((f) => (f || ouverte).focus()).catch(() => ouverte.focus())
    return self.clients.openWindow(cible)
  }))
})

// Abonnement renouvelé par le navigateur : l'appli le réenregistrera à la prochaine ouverture
self.addEventListener('pushsubscriptionchange', () => {})
