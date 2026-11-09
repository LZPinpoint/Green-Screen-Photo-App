// Standalone web build (public demo): `npx vite build` from src/renderer (see docs/WEB-DEMO.md).
// Electron builds use electron.vite.config.ts at the repo root instead (it never ships the in-browser ai files below).
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, join } from 'path'
import { createReadStream, existsSync, readFileSync, statSync } from 'fs'

/**
 * Web demo only: self-host the in-browser ai cutout. onnxruntime-web (MIT) wasm runtime + the SAME u2netp.onnx model the desktop
 * app ships (Apache-2.0) are served/emitted under ./ort/ and ./models/ — read from node_modules and resources/models, so there is no
 * second copy in git and nothing reaches the Electron renderer build.
 */
function webAiFiles(): Plugin {
  const root = resolve(__dirname, '../..')
  const files: Record<string, string> = {
    'ort/ort-wasm-simd-threaded.wasm': join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
    'ort/ort-wasm-simd-threaded.mjs': join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'),
    'models/u2netp.onnx': join(root, 'resources/models/u2netp.onnx')
  }
  const mime = (f: string) => (f.endsWith('.wasm') ? 'application/wasm' : f.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream')
  return {
    name: 'web-ai-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0].replace(/^\//, '')
        const src = files[url]
        if (!src || !existsSync(src)) return next()
        res.setHeader('Content-Type', mime(url)); res.setHeader('Content-Length', statSync(src).size)
        createReadStream(src).pipe(res)
      })
    },
    generateBundle() {
      for (const [out, src] of Object.entries(files)) {
        if (!existsSync(src)) this.error(`web demo ai file missing: ${src} (run npm install)`)
        this.emitFile({ type: 'asset', fileName: out, source: readFileSync(src) })
      }
    }
  }
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), webAiFiles()],
  define: { __WEB_DEMO__: 'true' },
  resolve: { alias: { '@webai': resolve(__dirname, 'keying'), '@shared': resolve(__dirname, '../shared'), '@core': resolve(__dirname, '../core') } },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
  worker: { format: 'es' },
  build: { outDir: resolve(__dirname, '../../dist-web'), emptyOutDir: true }
})
