// Standalone web build (public demo): `npx vite build` from src/renderer (see docs/WEB-DEMO.md).
// Electron builds use electron.vite.config.ts at the repo root instead.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, '../shared'), '@core': resolve(__dirname, '../core') } },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
  build: { outDir: resolve(__dirname, '../../dist-web'), emptyOutDir: true }
})
