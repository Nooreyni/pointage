// CFB Pointage — service worker (app installable + écran disponible hors ligne)
const CACHE = 'cfb-pointage-v2'
// Chemins relatifs à l'emplacement de l'appli (racine d'un domaine ou sous-dossier d'un serveur interne)
const COQUILLE = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png']
const ACCUEIL = new URL('./index.html', self.registration.scope).href

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  // API Supabase et autres origines : jamais en cache (données personnelles)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((rep) => { caches.open(CACHE).then((c) => c.put(ACCUEIL, rep.clone())); return rep })
        .catch(() => caches.match(ACCUEIL)),
    )
    return
  }
  // Fichiers versionnés (/assets/…-hash.js) : cache d'abord
  e.respondWith(
    caches.match(req).then((enCache) => enCache || fetch(req).then((rep) => {
      if (rep.ok) caches.open(CACHE).then((c) => c.put(req, rep.clone()))
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
