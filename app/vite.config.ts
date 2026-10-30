/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/',
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node' },
}))
