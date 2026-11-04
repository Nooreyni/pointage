// PWA sur le build de production (npm run build puis npx vite preview --port 4173) :
// installabilité (critères de Chrome), préchargement de tous les écrans, fonctionnement hors ligne, mise à jour proposée.
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const URL = process.env.E2E_PWA_URL || 'http://localhost:4173'
const DIST = path.join(__dirname, '..', 'dist')
const echecs = []; let reussis = 0
async function test(nom, fn) { try { await fn(); reussis++; console.log(`✅ ${nom}`) } catch (e) { echecs.push(nom); console.log(`❌ ${nom}\n   ${String(e.message).split('\n')[0]}`) } }
const verifier = (c, m) => { if (!c) throw new Error(m) }
const version = (page) => page.evaluate(() => new Promise((ok) => {
  const c = new MessageChannel(); c.port1.onmessage = (e) => ok(e.data); navigator.serviceWorker.controller.postMessage('VERSION', [c.port2])
}))

;(async () => {
  const navigateur = await chromium.launch()
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 } })
  const page = await contexte.newPage(); const erreurs = []; page.on('pageerror', (e) => erreurs.push(e.message))
  await page.goto(`${URL}/`); await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload(); await page.waitForTimeout(800)

  await test('installable selon Chrome (manifeste, icônes, service worker)', async () => {
    const cdp = await contexte.newCDPSession(page)
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
    await cdp.detach()   // (une session restée ouverte annule la simulation « hors ligne » des tests suivants)
    verifier(!installabilityErrors.length, installabilityErrors.map((e) => e.errorId).join(', '))
    const m = await (await page.request.get(`${URL}/manifest.webmanifest`)).json()
    for (const ic of [...m.icons, ...m.screenshots]) verifier((await page.request.get(`${URL}/${ic.src}`)).ok(), `fichier manquant : ${ic.src}`)
  })

  await test('service worker actif, tous les fichiers préchargés', async () => {
    verifier(await page.evaluate(() => !!navigator.serviceWorker.controller), 'la page n’est pas contrôlée par le service worker')
    const liste = JSON.parse(fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8').match(/const PRECACHE = (\[.*?\])/s)[1])
    const manquants = await page.evaluate(async (l) => { const r = []; for (const f of l) if (!(await caches.match(new URL(f, location.href).href, { ignoreVary: true }))) r.push(f); return r }, liste)
    verifier(!manquants.length, `pas en cache : ${manquants.slice(0, 3).join(', ')}`)
  })

  await test('hors ligne : l’appli s’ouvre et chaque écran s’affiche', async () => {
    await page.goto(`${URL}/?demo=1&vue=admin`); await page.waitForSelector('nav.nav'); await page.waitForTimeout(600)   // la démo, chargée une fois
    await contexte.setOffline(true)
    try {
      await page.reload(); await page.waitForSelector('nav.nav', { timeout: 10000 })
      verifier(await page.waitForSelector('.bandeau-hors-ligne', { timeout: 5000 }).catch(() => null),
        `bandeau « hors ligne » absent (navigator.onLine = ${await page.evaluate(() => navigator.onLine)})`)
      const n = (await page.$$('nav.nav button')).length
      for (let i = 0; i < n; i++) {
        await page.click(`nav.nav button >> nth=${i}`); await page.waitForTimeout(400)
        const sous = (await page.$$('.sous-nav button')).length
        for (let k = 0; k < sous; k++) { await page.click(`.sous-nav button >> nth=${k}`); await page.waitForTimeout(400) }
      }
      verifier(!erreurs.length, `écran non disponible hors ligne : ${erreurs[0]}`)
    } finally { await contexte.setOffline(false) }
  })

  await test('nouvelle version : proposée (pas imposée), appliquée après « Mettre à jour »', async () => {
    const chemin = path.join(DIST, 'sw.js'), original = fs.readFileSync(chemin, 'utf8')
    const avant = await version(page)
    fs.writeFileSync(chemin, original.replace(/const VERSION = "([^"]+)"/, 'const VERSION = "$1-essai"'))
    try {
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
      await page.waitForSelector('.bandeau-maj', { timeout: 15000 })
      verifier(await version(page) === avant, 'la nouvelle version a pris la main sans attendre')
      await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('.bandeau-maj button')])
      await page.waitForTimeout(800)
      verifier(await version(page) === `${avant}-essai`, 'la nouvelle version n’est pas active après « Mettre à jour »')
      verifier(!(await page.$('.bandeau-maj')), 'le bandeau reste affiché après la mise à jour')
    } finally { fs.writeFileSync(chemin, original) }
  })

  await test('Mon compte : carte « Appli sur cet appareil »', async () => {
    await page.goto(`${URL}/?demo=1&onglet=compte`); await page.waitForSelector('nav.nav'); await page.waitForTimeout(500)
    verifier(/Appli sur cet appareil/.test(await page.textContent('main')), 'carte absente')
  })

  await navigateur.close()
  console.log(`\n${reussis} réussi(s), ${echecs.length} échec(s)`); process.exit(echecs.length ? 1 : 0)
})()
