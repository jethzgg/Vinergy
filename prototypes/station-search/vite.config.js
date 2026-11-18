import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Single source of truth: the repository station fixture (README "Station fixture JSON").
      '@fixture': path.resolve(repoRoot, 'data/seed_stations_v0.json'),
    },
  },
  server: {
    port: 5173,
    open: false,
    fs: { allow: [here, repoRoot] },
  },
})
