/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => ({
  base: './',   // chemins relatifs : fonctionne à la racine d'un domaine comme dans un sous-dossier (serveur interne)
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node' },
}))
