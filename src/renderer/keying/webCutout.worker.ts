// In-browser person cutout for the web demo: onnxruntime-web (MIT, wasm, single thread) + the SAME u2netp.onnx the desktop app ships
// (Apache-2.0). Self-hosted wasm + model under ./ort/ and ./models/ (see src/renderer/vite.config.ts); nothing is fetched from a CDN.
// Mirrors src/main/ai/cutout.ts: squash to 320x320, divide by max pixel, ImageNet mean/std, min-max the output, upscale.
import { refineMatte } from './matte'

type Ort = typeof import('onnxruntime-web/wasm')
const N = 320
const MODEL = 'models/u2netp.onnx'
const CACHE = 'imagine-booth-ai-v1'

let session: Promise<{ ort: Ort; s: import('onnxruntime-web/wasm').InferenceSession }> | undefined
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void }
const status = (state: 'loading' | 'ready' | 'error', detail?: string) => ctx.postMessage({ type: 'status', state, detail })

async function modelBytes(url: string): Promise<ArrayBuffer> {
  // cached after the first load so the demo works offline afterwards
  try {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) return await hit.arrayBuffer()
    const res = await fetch(url)
    if (!res.ok) throw new Error('model download failed (' + res.status + ')')
    await cache.put(url, res.clone()).catch(() => {})
    return await res.arrayBuffer()
  } catch (e) {
    const res = await fetch(url)
    if (!res.ok) throw new Error('model download failed (' + res.status + ')')
    return await res.arrayBuffer()
  }
}

function load() {
  return (session ??= (async () => {
    status('loading')
    try {
      const root = (self as unknown as { __root?: string }).__root ?? new URL('../', self.location.href).href
      const ort = await import('onnxruntime-web/wasm')
      ort.env.wasm.wasmPaths = root + 'ort/'
      ort.env.wasm.numThreads = 1          // no cross-origin isolation needed on a plain static host
      ort.env.wasm.proxy = false
      const bytes = await modelBytes(root + MODEL)
      const s = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      status('ready')
      return { ort, s }
    } catch (e) { session = undefined; status('error', e instanceof Error ? e.message : String(e)); throw e }
  })())
}

interface Opts { lo?: number; hi?: number; flip?: boolean; raw?: boolean }
async function cutout(dataUrl: string, maxDim: number, opts: Opts = {}): Promise<string> {
  const { ort, s } = await load()
  const blob = await (await fetch(dataUrl)).blob()
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  let w = bmp.width, h = bmp.height
  if (Math.max(w, h) > maxDim) { const k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k) }
  const full = new OffscreenCanvas(w, h)
  const fctx = full.getContext('2d', { willReadFrequently: true })!
  fctx.drawImage(bmp, 0, 0, w, h); bmp.close()

  // model input: squash to NxN (same as the desktop path), /max, ImageNet normalise
  const small = new OffscreenCanvas(N, N)
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(full, 0, 0, N, N)
  const px = sctx.getImageData(0, 0, N, N).data
  const plane = N * N, input = new Float32Array(3 * plane)
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]
  let max = 1; for (let i = 0; i < px.length; i += 4) { if (px[i] > max) max = px[i]; if (px[i + 1] > max) max = px[i + 1]; if (px[i + 2] > max) max = px[i + 2] }
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (px[i * 4 + c] / max - mean[c]) / std[c]
  const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, N, N]) })
  let out = res[s.outputNames[0]].data as Float32Array
  if (opts.flip ?? true) {
    // test-time augmentation: average with the mirrored picture's matte (steadier on hair / dark clothes)
    const fin = new Float32Array(3 * plane)
    for (let c = 0; c < 3; c++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fin[c * plane + y * N + x] = input[c * plane + y * N + (N - 1 - x)]
    const r2 = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', fin, [1, 3, N, N]) })
    const o2 = r2[s.outputNames[0]].data as Float32Array
    const avg = new Float32Array(plane)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) avg[y * N + x] = (out[y * N + x] + o2[y * N + (N - 1 - x)]) / 2
    out = avg
  }

  // clean the soft matte, then upscale it with the browser's bilinear filter and use it as the alpha channel
  const m = refineMatte(out, N, N, { lo: opts.lo, hi: opts.hi })
  const mc = new OffscreenCanvas(N, N)
  const mctx = mc.getContext('2d')!
  const mi = mctx.createImageData(N, N)
  for (let i = 0; i < plane; i++) { const v = Math.round(m[i] * 255); mi.data[i * 4] = v; mi.data[i * 4 + 1] = v; mi.data[i * 4 + 2] = v; mi.data[i * 4 + 3] = 255 }
  mctx.putImageData(mi, 0, 0)
  const up = new OffscreenCanvas(w, h)
  const uctx = up.getContext('2d', { willReadFrequently: true })!
  uctx.imageSmoothingQuality = 'high'
  uctx.drawImage(mc, 0, 0, w, h)
  const alpha = uctx.getImageData(0, 0, w, h).data
  const img = fctx.getImageData(0, 0, w, h)
  for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = alpha[i * 4]
  fctx.putImageData(img, 0, 0)
  const png = await full.convertToBlob({ type: 'image/png' })
  return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = () => reject(r.error); r.readAsDataURL(png) })
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, op, url, maxDim, root, opts } = e.data as { id: number; op: string; url?: string; maxDim?: number; root?: string; opts?: Opts }
  if (root) (self as unknown as { __root?: string }).__root = root
  try {
    if (op === 'warm') { await load(); ctx.postMessage({ id, ok: true }) }
    else ctx.postMessage({ id, ok: true, result: await cutout(url!, maxDim ?? 1600, opts) })
  } catch (err) { ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }) }
}
