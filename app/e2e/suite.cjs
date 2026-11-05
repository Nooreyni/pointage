// Parcours de bout en bout dans un vrai navigateur (Chromium), sur la démo (?demo=1) : rien n'est enregistré.
// Lancer : npm run dev (dans un autre terminal), puis npm run e2e. Adresse : E2E_URL (défaut http://localhost:5173).
// Vérifie, pour chaque rôle, sur mobile et sur PC : aucun plantage, aucune page qui déborde, accessibilité WCAG A/AA (axe),
// la superposition (en-tête, onglets, menus, fenêtres), l'aide, la fiche d'une demande, la création d'une fiche personne.
const { chromium } = require('playwright')
const fs = require('fs')
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const URL = process.env.E2E_URL || 'http://localhost:5173'
const ROLES = ['employe', 'chef', 'rh', 'direction', 'admin']
const LARGEURS = [390, 1280]

const echecs = []; let reussis = 0
async function test(nom, fn) {
  try { await fn(); reussis++; console.log(`✅ ${nom}`) } catch (e) { echecs.push(nom); console.log(`❌ ${nom}\n   ${String(e.message).split('\n')[0]}`) }
}
const verifier = (cond, message) => { if (!cond) throw new Error(message) }

;(async () => {
  const navigateur = await chromium.launch()
  const ouvrir = async (vue, largeur, onglet = '') => {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: largeur < 600 ? 844 : 800 } })
    page.erreurs = []; page.on('pageerror', (e) => page.erreurs.push(e.message))
    await page.goto(`${URL}/?demo=1&vue=${vue}${onglet ? `&onglet=${onglet}` : ''}`); await page.waitForSelector('nav.nav'); await page.waitForTimeout(500)
    return page
  }
  const accessibilite = async (page) => {
    await page.addScriptTag({ content: axe })
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((x) => `${x.id} (${x.nodes[0]?.target.join(' ')})`))
    verifier(!v.length, `accessibilité : ${v.join(', ')}`)
    verifier(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'la page déborde horizontalement')
    verifier(!page.erreurs.length, `erreur JavaScript : ${page.erreurs[0]}`)
  }
  const auPremierPlan = (page, x, y, selecteur) => page.evaluate(([x, y, s]) => !!document.elementFromPoint(x, y)?.closest(s), [x, y, selecteur])

  // 1. Chaque rôle, chaque largeur : tous les onglets et sous-onglets s'ouvrent, sans défaut
  for (const vue of ROLES) for (const l of LARGEURS) {
    await test(`${vue} · ${l}px : tous les écrans s'ouvrent, accessibles`, async () => {
      const page = await ouvrir(vue, l)
      await accessibilite(page)
      const groupes = await page.$$eval('nav.nav button', (b) => b.map((x) => x.textContent.trim()))
      for (let i = 0; i < groupes.length; i++) {
        await page.click(`nav.nav button >> nth=${i}`); await page.waitForTimeout(350)
        const sous = await page.$$('.sous-nav button')
        for (let k = 0; k < Math.max(1, sous.length); k++) {
          if (sous.length) { await page.click(`.sous-nav button >> nth=${k}`); await page.waitForTimeout(450) }
          verifier(await page.$('main'), `écran vide (${groupes[i]})`)
          await accessibilite(page)
        }
      }
      await page.close()
    })
  }

  // 2. Superposition : l'en-tête et les onglets restent devant le contenu ; menus et fenêtres devant tout
  for (const l of [1375, 390]) {
    await test(`superposition · ${l}px`, async () => {
      const page = await ouvrir('admin', l, 'heures')
      for (const y of [80, 400]) {
        await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(120)
        const [x, yy] = await page.$eval('.entete', (e) => { const r = e.getBoundingClientRect(); return [r.left + 60, r.bottom - 6] })
        verifier(await auPremierPlan(page, x, yy, '.entete'), `en-tête recouvert après ${y}px de défilement`)
      }
      await page.click('.avatar'); await page.waitForSelector('.menu')
      const coins = await page.$eval('.menu', (e) => { const r = e.getBoundingClientRect(); return [[r.left + 20, r.top + 10], [r.left + 20, r.bottom - 10]] })
      for (const [x, y] of coins) verifier(await auPremierPlan(page, x, y, '.menu'), 'menu du compte recouvert')
      await page.keyboard.press('Escape'); await page.mouse.click(10, 700)
      await page.click('.bouton-recherche'); await page.waitForSelector('.recherche-fenetre'); await page.waitForTimeout(350)
      verifier(await auPremierPlan(page, l - 30, 20, '.voile'), 'la recherche ne couvre pas l’en-tête')
      verifier(await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'), 'la page défile derrière une fenêtre')
      await page.keyboard.press('Escape'); await page.close()
    })
  }

  // 3. Aide : bouton « ? » sur l'écran ouvert, page Aide avec recherche
  await test('aide contextuelle et page Aide', async () => {
    const page = await ouvrir('rh', 390, 'conges')
    await page.click('.bouton-aide'); await page.waitForSelector('.fenetre .en-bref'); await page.waitForTimeout(400)
    verifier((await page.textContent('.fenetre h2')).includes('Congés'), 'l’aide ne correspond pas à l’écran')
    await accessibilite(page)
    await page.click('.fenetre button:has-text("Toute l’aide")'); await page.waitForSelector('#recherche-aide')
    await page.fill('#recherche-aide', 'mot de passe'); await page.waitForTimeout(200)
    verifier(/réponse/.test(await page.textContent('[role=status]')), 'la recherche ne trouve rien')
    await page.close()
  })

  // 4. Valider une demande depuis sa fiche
  await test('fiche d’une demande : refuser avec motif, passer à la suivante', async () => {
    const page = await ouvrir('chef', 1280, 'conges')
    await page.click('.sous-onglets button:has-text("À valider")'); await page.waitForSelector('.a-valider')
    await page.click('.a-valider li button:has-text("Ouvrir") >> nth=0'); await page.waitForSelector('.resume-demande'); await page.waitForTimeout(500)
    await accessibilite(page)
    const premiere = await page.textContent('.fenetre h2')
    await page.click('.fenetre .bouton-refus')
    verifier(await page.$eval('.fenetre button:has-text("Refuser la demande")', (b) => b.disabled), 'refus possible sans motif')
    await page.fill('#fiche-motif-refus', 'Trop d’absences'); await page.click('.fenetre button:has-text("Refuser la demande")'); await page.waitForTimeout(700)
    verifier(await page.$('.fenetre') && (await page.textContent('.fenetre h2')) !== premiere, 'pas de passage à la demande suivante')
    await page.close()
  })

  // 5. Créer une fiche : elle reste ouverte, sur l'onglet Compte ; ✕ la ferme
  await test('RH : créer une personne, la fiche reste ouverte', async () => {
    const page = await ouvrir('rh', 390, 'personnes')
    await page.click('button:has-text("Nouvelle personne")'); await page.waitForSelector('#p-prenom'); await page.waitForTimeout(400)
    await page.fill('#p-prenom', 'Zoé'); await page.fill('#p-nom', 'Essai'); await page.click('button.suggestion'); await page.selectOption('#p-service', { index: 1 })
    await page.click('button:has-text("Créer la fiche")'); await page.waitForSelector('.onglets-fiche'); await page.waitForTimeout(400)
    verifier((await page.textContent('.onglets-fiche [aria-selected=true]')).includes('Compte'), 'la fiche ne s’ouvre pas sur Compte')
    await accessibilite(page)
    await page.click('.fermer-fenetre'); await page.waitForTimeout(300)
    verifier(!(await page.$('.fenetre')), 'le bouton ✕ ne ferme pas la fiche')
    await page.close()
  })

  // 6. Congés sur PC : cartes de même hauteur dans chaque rangée
  await test('Congés PC : rangées équilibrées', async () => {
    const page = await ouvrir('employe', 1280, 'conges'); await page.waitForSelector('.prochains-conges')
    const h = await page.$$eval('.grille-2', (g) => g.map((x) => [...x.children].map((c) => Math.round(c.getBoundingClientRect().height))))
    verifier(h.length === 2 && h.every(([a, b]) => Math.abs(a - b) <= 2), `hauteurs ${JSON.stringify(h)}`)
    await page.close()
  })

  // 7. Longues listes (pensé pour ~100 personnes) : pagination, une ligne par personne, pas de trou dans les réglages
  await test('densité : pagination, une ligne par personne, réglages sans trous', async () => {
    const page = await ouvrir('admin', 1600, 'personnes'); await page.waitForTimeout(600)
    const n = (await page.$$('.liste-personnes > li')).length
    verifier(n > 0 && n <= 25, `${n} personnes affichées d’un coup (25 max)`)
    verifier(await page.$('.pagination'), 'pagination absente sur Personnes')
    await page.click('.sous-nav button:has-text("Suivi RH")'); await page.waitForSelector('.liste-anomalies')
    const noms = await page.$$eval('.liste-anomalies > li .qui', (l) => l.map((x) => x.firstElementChild.textContent))
    verifier(new Set(noms).size === noms.length, 'une même personne apparaît sur plusieurs lignes')
    verifier(!(await page.$('.jours-anomalies')), 'les jours doivent être repliés par défaut')
    await page.click('.bouton-pilule >> nth=0'); verifier(await page.waitForSelector('.jours-anomalies'), 'les jours ne se déplient pas')
    await page.click('.sous-nav button:has-text("Réglages")'); await page.click('button:has-text("Paramètres") >> nth=0'); await page.waitForTimeout(600)
    const ecarts = await page.$$eval('.grille-cartes.maconnerie > .carte', (l) => {
      const parX = {}
      for (const c of l) { const r = c.getBoundingClientRect(), x = Math.round(r.left); parX[x] = parX[x] || []; parX[x].push([r.top, r.bottom]) }
      return Object.values(parX).map((v) => v.sort((a, b) => a[0] - b[0]).slice(1).map((x, i) => Math.round(x[0] - v[i][1])))
    })
    verifier(ecarts.length === 2 && ecarts.flat().every((g) => g <= 24), `écarts entre cartes : ${JSON.stringify(ecarts)}`)
    verifier(!page.erreurs.length, `erreur JavaScript : ${page.erreurs[0]}`)
    await page.close()
  })

  await navigateur.close()
  console.log(`\n${reussis} réussi(s), ${echecs.length} échec(s)`)
  process.exit(echecs.length ? 1 : 0)
})()
