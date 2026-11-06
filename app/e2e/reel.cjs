// Parcours de bout en bout sur l'application RÉELLE (lib/supabase.ts) : base locale (e2e/base-locale.sh)
// + mini serveur compatible Supabase (e2e/mini-supabase.cjs) + appli (vite, VITE_SUPABASE_URL=http://localhost:54321).
// Contrairement à suite.cjs (démo), ici chaque clic passe par les vraies vues, fonctions et règles d'accès de la base.
// Lancer : npm run e2e:reel (voir README). Adresse de l'appli : E2E_REEL_URL (défaut http://localhost:5174).
const { chromium } = require('playwright')
const URL = process.env.E2E_REEL_URL || 'http://localhost:5174'
const MDP = process.env.MDP_TEST || 'Test-CFB-2026'

const echecs = []; let reussis = 0
async function test(nom, fn) {
  try { await fn(); reussis++; console.log(`✅ ${nom}`) } catch (e) { echecs.push(nom); console.log(`❌ ${nom}\n   ${String(e.message).split('\n')[0]}`) }
}
const verifier = (cond, message) => { if (!cond) throw new Error(message) }

;(async () => {
  const navigateur = await chromium.launch()
  // Ouvre une session : connexion par mot de passe, attend l'espace ; garde les erreurs JS et les réponses d'API en échec
  async function connecter(email, largeur = 1280) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: 860 } })
    page.erreurs = []; page.api = []
    page.on('pageerror', (e) => page.erreurs.push(e.message))
    page.on('response', (r) => {
      const u = r.url()
      if (u.includes('/rest/v1/') || u.includes('/auth/v1/')) { if (r.status() >= 400) page.api.push(`${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`) }
    })
    await page.goto(URL); await page.waitForSelector('#cx-email')
    await page.fill('#cx-email', email); await page.fill('#cx-mdp', MDP); await page.click('button:has-text("Se connecter")')
    await page.waitForSelector('nav.nav', { timeout: 15000 }); await page.waitForTimeout(800)
    return page
  }
  const propre = (page, quoi) => {
    verifier(!page.erreurs.length, `${quoi} : erreur JavaScript « ${page.erreurs[0]} »`)
    verifier(!page.api.length, `${quoi} : appel en échec ${page.api[0]}`)
  }
  async function toutVisiter(page) {
    const n = (await page.$$('nav.nav button')).length
    for (let i = 0; i < n; i++) {
      await page.click(`nav.nav button >> nth=${i}`); await page.waitForTimeout(700)
      const sous = (await page.$$('.sous-nav button')).length
      for (let k = 0; k < sous; k++) { await page.click(`.sous-nav button >> nth=${k}`); await page.waitForTimeout(800) }
    }
    for (const o of ['alertes', 'compte', 'aide']) {
      if (o === 'alertes') await page.click('button.cloche[aria-label^="Alertes"]')
      else { await page.click('.avatar'); await page.click(`.menu button:has-text("${o === 'compte' ? 'Mon compte' : 'Aide'}")`) }
      await page.waitForTimeout(700)
    }
  }

  const COMPTES = [['sofia.janssens@cfb.test', 'employée'], ['marc.dupont@cfb.test', 'chef de service'], ['jordan.kabongo@cfb.test', 'ISP'],
                   ['nadia.benali@cfb.test', 'RH'], ['ines.leroy@cfb.test', 'admin RH'], ['claire.lambert@cfb.test', 'direction'], ['admin.it@cfb.test', 'admin général']]
  for (const [email, role] of COMPTES) for (const l of [390, 1280]) {
    await test(`${role} · ${l}px : connexion et tous les écrans, sans erreur d'API`, async () => {
      const page = await connecter(email, l); await toutVisiter(page); propre(page, role); await page.close()
    })
  }

  await test('nouvel utilisateur : parcours d’accueil (horaires, étapes passées), plus reproposé ensuite', async () => {
    const page = await connecter('yanis.peeters@cfb.test', 390)
    await page.waitForSelector('.parcours', { timeout: 5000 })
    await page.click('.actions-parcours button:has-text("C’est parti")')
    await page.click('.puces.horaires button:has-text("8h – 16h")'); await page.waitForSelector('.horaire-habituel :text("Retenu")')
    await page.click('.actions-parcours button:has-text("Suivant")')
    for (let i = 0; i < 3; i++) { await page.click('.actions-parcours button:has-text("Passer")'); await page.waitForTimeout(200) }
    await page.click('.actions-parcours button:has-text("Commencer")'); await page.waitForTimeout(600)
    verifier(!(await page.$('.parcours')), 'le parcours reste affiché après « Commencer »')
    await page.reload(); await page.waitForSelector('nav.nav'); await page.waitForTimeout(1000)
    verifier(!(await page.$('.parcours')), 'le parcours est reproposé alors qu’il est terminé')
    await page.click('.profil-entete'); await page.click('.menu button:has-text("Mon compte")'); await page.waitForTimeout(800)
    verifier(/Retenu : 8h – 16h/.test(await page.textContent('#mes-horaires')), 'horaire non retrouvé dans Mon compte')
    propre(page, 'parcours'); await page.close()
  })

  await test('info fausse : l’employée la signale, la RH la voit, ouvre la fiche et la marque corrigée', async () => {
    const sofia = await connecter('sofia.janssens@cfb.test')
    await sofia.click('.profil-entete'); await sofia.click('.menu button:has-text("Mon compte")'); await sofia.waitForTimeout(600)
    await sofia.click('button:has-text("Signaler à la RH")'); await sofia.click('.fenetre .puce:has-text("Service")')
    await sofia.fill('.fenetre textarea', 'Je suis au CEFOR depuis octobre'); await sofia.click('.fenetre button:has-text("Envoyer à la RH")')
    await sofia.waitForSelector('.signaler-info :text("En attente à la RH")', { timeout: 5000 })
    propre(sofia, 'signalement'); await sofia.close()
    const rh = await connecter('nadia.benali@cfb.test')
    await rh.click('nav.nav button:has-text("Gestion")'); await rh.waitForSelector('.infos-a-corriger', { timeout: 8000 })
    verifier(/CEFOR depuis octobre/.test(await rh.textContent('.infos-a-corriger')), 'signalement absent du Suivi RH')
    await rh.click('.infos-a-corriger button:has-text("Corrigé")'); await rh.waitForTimeout(800)
    verifier(!(await rh.$('.infos-a-corriger')), 'le signalement reste affiché après « Corrigé »')
    propre(rh, 'traitement'); await rh.close()
  })

  await test('employée : pointer l’entrée puis la sortie', async () => {
    const page = await connecter('sofia.janssens@cfb.test')
    await page.click('nav.nav button:has-text("Pointer")'); await page.waitForSelector('.bouton-pointer')
    const avant = await page.textContent('.bouton-pointer')
    await page.click('.bouton-pointer'); await page.waitForTimeout(1200)
    const apres = await page.textContent('.bouton-pointer')
    verifier(avant !== apres, `le bouton n’a pas changé (« ${avant} »)`)
    await page.click('.bouton-pointer'); await page.waitForTimeout(1200)
    propre(page, 'pointage'); await page.close()
  })

  let periode = ''
  await test('employée : demander un congé (décompte affiché, demande en attente)', async () => {
    const page = await connecter('sofia.janssens@cfb.test')
    await page.click('nav.nav button:has-text("Congés")'); await page.waitForSelector('.prochains-conges')
    // Une date ouvrable dans trois semaines (sans conflit avec les données fictives)
    const d = new Date(Date.now() + 21 * 86400000); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
    periode = d.toISOString().slice(0, 10)
    const debut = await page.$('input[type=date] >> nth=0'); await debut.fill(periode)
    const fin = await page.$('input[type=date] >> nth=1'); if (fin) await fin.fill(periode)
    await page.waitForTimeout(900)
    verifier(/Décompte/.test(await page.textContent('main')), 'pas de décompte affiché avant l’envoi')
    await page.click('button:has-text("Envoyer la demande")'); await page.waitForTimeout(1200)
    verifier(/En attente/.test(await page.textContent('main')), 'la demande n’apparaît pas « En attente »')
    propre(page, 'demande'); await page.close()
  })

  await test('chef de service : ouvrir la demande, voir le solde, accepter', async () => {
    const page = await connecter('marc.dupont@cfb.test')
    await page.click('nav.nav button:has-text("Congés")'); await page.click('.sous-onglets button:has-text("À valider")'); await page.waitForSelector('.a-valider')
    const ligne = page.locator('.a-valider li', { hasText: 'Sofia' }).first()
    await ligne.locator('button:has-text("Ouvrir")').click(); await page.waitForSelector('.resume-demande'); await page.waitForTimeout(1200)
    verifier(/Avant/.test(await page.textContent('.fenetre')), 'solde avant / après absent de la fiche')
    await page.click('.fenetre .actions button.bouton:not(.secondaire)'); await page.waitForTimeout(1500)
    propre(page, 'validation'); await page.close()
    const sofia = await connecter('sofia.janssens@cfb.test'); await sofia.click('nav.nav button:has-text("Congés")'); await sofia.waitForTimeout(1200)
    verifier(/Accordée/.test(await sofia.textContent('main')), 'la demande n’est pas « Accordée » côté employée')
    propre(sofia, 'retour employée'); await sofia.close()
  })

  await test('RH : créer une personne, programmer un 4/5, voir ses soldes', async () => {
    const page = await connecter('nadia.benali@cfb.test')
    await page.click('nav.nav button:has-text("Gestion")'); await page.click('.sous-nav button:has-text("Personnes")'); await page.waitForSelector('.liste-personnes li')
    await page.click('button:has-text("Nouvelle personne")'); await page.waitForSelector('#p-prenom'); await page.waitForTimeout(400)
    await page.fill('#p-prenom', 'Pilote'); await page.fill('#p-nom', `Essai${Date.now() % 100000}`)
    await page.click('button.suggestion'); await page.selectOption('#p-service', { index: 1 })
    await page.click('button:has-text("Créer la fiche")'); await page.waitForSelector('.onglets-fiche', { timeout: 10000 }); await page.waitForTimeout(800)
    await page.click('.onglets-fiche button:has-text("Horaire")'); await page.click('.fenetre button:has-text("Jours au choix")')
    await page.click('.fenetre .jours-tt button:has-text("Mer")'); await page.click('.fenetre button:has-text("Programmer ces jours")'); await page.waitForTimeout(1200)
    await page.click('.onglets-fiche button:has-text("Soldes")'); await page.waitForTimeout(900)
    propre(page, 'fiche'); await page.close()
  })

  await test('RH : reprendre des soldes depuis un fichier (Dinclock)', async () => {
    const page = await connecter('nadia.benali@cfb.test')
    await page.click('nav.nav button:has-text("Gestion")'); await page.click('.sous-nav button:has-text("Personnes")'); await page.waitForSelector('.liste-personnes li')
    await page.click('button:has-text("Reprendre des soldes")'); await page.waitForSelector('.fenetre input[type=file]', { state: 'attached' }); await page.waitForTimeout(500)
    const csv = 'email;compteur;solde;date\nyanis.peeters@cfb.test;Congés extra-légaux;12:30;\ninconnu@cfb.test;Congés annuels;10;\n'
    await page.setInputFiles('.fenetre input[type=file]', { name: 'soldes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await page.waitForTimeout(500)
    verifier(/1<\/strong> solde\(s\) prêt/.test(await page.innerHTML('.fenetre')), 'aperçu : 1 ligne prête attendue (l’autre refusée)')
    await page.click('.fenetre button:has-text("Reprendre 1 solde")'); await page.waitForSelector('.fenetre [role=status]'); await page.waitForTimeout(500)
    verifier(/1 solde\(s\) repris/.test(await page.textContent('.fenetre [role=status]')), 'la reprise n’a pas été enregistrée')
    await page.click('.fenetre button:has-text("Terminé")')
    await page.fill('#filtre-personnes', 'Peeters'); await page.waitForTimeout(300); await page.click('.liste-personnes li button >> nth=0'); await page.waitForSelector('.onglets-fiche')
    await page.click('.onglets-fiche button:has-text("Soldes")'); await page.waitForTimeout(900)
    await page.click('.fenetre button:has-text("historique")'); await page.waitForTimeout(400)
    verifier(/Reprise des soldes Dinclock/.test(await page.textContent('.fenetre')), 'la reprise n’apparaît pas dans l’historique')
    propre(page, 'reprise des soldes'); await page.close()
  })

  await test('direction : accorder un accès temporaire à un autre service', async () => {
    const page = await connecter('claire.lambert@cfb.test')
    await page.click('nav.nav button:has-text("Gestion")'); await page.click('.sous-nav button:has-text("Réglages")')
    await page.click('[role=tablist][aria-label=Réglages] button:has-text("Accès")'); await page.waitForSelector('#a-personne')
    await page.selectOption('#a-personne', { index: 2 }); await page.selectOption('#a-service', { index: 2 }); await page.selectOption('#a-droit', '1')
    await page.fill('#a-jusqu', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)); await page.click('button:has-text("Accorder")'); await page.waitForTimeout(1200)
    verifier(/Jusqu’au/.test(await page.textContent('main')), 'la date de fin n’apparaît pas')
    propre(page, 'accès'); await page.close()
  })

  await test('admin général : chaque onglet des Réglages, journal et erreurs de l’appli', async () => {
    const page = await connecter('admin.it@cfb.test')
    await page.click('nav.nav button:has-text("Gestion")'); await page.click('.sous-nav button:has-text("Réglages")'); await page.waitForTimeout(800)
    const n = (await page.$$('[role=tablist][aria-label=Réglages] button')).length
    for (let i = 0; i < n; i++) { await page.click(`[role=tablist][aria-label=Réglages] button >> nth=${i}`); await page.waitForTimeout(700) }
    verifier(/Testeurs/.test(await page.textContent('main')), 'section « Avis des testeurs » vide')
    await page.click('[role=tablist][aria-label=Réglages] button:has-text("Journal")'); await page.waitForTimeout(700)
    verifier(/Erreurs de l’appli/.test(await page.textContent('main')), 'carte « Erreurs de l’appli » absente du Journal')
    propre(page, 'réglages'); await page.close()
  })

  await test('employée : les écrans de gestion lui restent fermés', async () => {
    const page = await connecter('sofia.janssens@cfb.test')
    const groupes = await page.$$eval('nav.nav button', (b) => b.map((x) => x.textContent))
    verifier(!groupes.some((g) => /Gestion|Rapports/.test(g)), `onglets de gestion visibles : ${groupes.join(', ')}`)
    await page.goto(`${URL}/?onglet=personnes`); await page.waitForSelector('nav.nav'); await page.waitForTimeout(800)
    verifier(!(await page.$('.liste-personnes')), 'la liste des personnes s’affiche par lien direct')
    await page.close()
  })

  await navigateur.close()
  console.log(`\n${reussis} réussi(s), ${echecs.length} échec(s)`)
  process.exit(echecs.length ? 1 : 0)
})()
