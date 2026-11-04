/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * PWA : après le build, inscrit dans dist/sw.js la liste des fichiers à précharger (tous les écrans, styles,
 * icônes, polices latines) et une version = empreinte de cette liste. Chaque déploiement change la version :
 * le service worker se met à jour, l'appli propose « Mettre à jour ». La démo et les polices des autres
 * alphabets (grec, cyrillique, vietnamien) ne sont pas préchargées : chargées seulement si besoin.
 */
function precachePwa(): Plugin {
  let sortie = 'dist'
  return {
    name: 'cfb-precache-pwa',
    apply: 'build',
    configResolved(c) { sortie = c.build.outDir },
    writeBundle(_o, bundle) {
      const fichiers = Object.keys(bundle).filter((f) =>
        /\.(js|css)$/.test(f) ? !/\/demo-/.test(f) : /\.woff2$/.test(f) ? /(latin|fraunces-latin)/.test(f) && !/(greek|cyrillic|vietnamese)/.test(f) : false)
      const liste = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
        './icons/apple-touch-icon.png', ...fichiers.sort().map((f) => `./${f}`)]
      const version = createHash('sha256').update(liste.join('\n')).digest('hex').slice(0, 12)
      const chemin = join(sortie, 'sw.js')
      const sw = readFileSync(chemin, 'utf8')
      if (!sw.includes('__PRECACHE__')) throw new Error('sw.js : repère __PRECACHE__ introuvable')
      writeFileSync(chemin, sw.replace("'__VERSION__'", JSON.stringify(version)).replace('[/* __PRECACHE__ */]', JSON.stringify(liste)))
    },
  }
}

export default defineConfig(() => ({
  base: './',   // chemins relatifs : fonctionne à la racine d'un domaine comme dans un sous-dossier (serveur interne)
  plugins: [react(), precachePwa()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node' },
}))
