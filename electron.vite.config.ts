import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const alias = { '@shared': resolve('src/shared'), '@core': resolve('src/core') }

export default defineConfig({
  main: { resolve: { alias }, build: { rollupOptions: { external: ['sharp', 'onnxruntime-node'] } } },
  preload: { resolve: { alias } },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
