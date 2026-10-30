// CFB Pointage — service worker (app installable + écran disponible hors ligne)
const CACHE = 'cfb-pointage-v1'
const COQUILLE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png']

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
        .then((rep) => { caches.open(CACHE).then((c) => c.put('/index.html', rep.clone())); return rep })
        .catch(() => caches.match('/index.html')),
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

// Notifications push (envoyées par le moteur de rappels)
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(d.titre || 'CFB Pointage', {
    body: d.corps || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { lien: d.lien || '/' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.openWindow(e.notification.data.lien || '/'))
})
