// Heavy image work for staff mode: decode -> chroma key -> compose -> print sheet -> JPEG.
// Runs inside a Web Worker (engine.worker.ts) so the operator UI never stalls; the same code is the
// main-thread fallback (engineClient.ts) if workers are unavailable. DOM-free: OffscreenCanvas + createImageBitmap only.
import { chromaKey, composeScene, layoutSheet, keyQuality } from '@core/index'
import type { BackgroundScene, KeyParams, PrintLayout } from '../../shared/types'

export interface Img { data: Uint8ClampedArray; width: number; height: number }
export interface SceneRef { file: string; url: string; anchor: BackgroundScene['anchor'] }
export interface ShotRef { cacheKey: string; url?: string }
export interface ComposeMsg {
  shots: ShotRef[]; key: KeyParams; keyMaxDim: number
  scene: SceneRef; frame?: { file: string; url: string }
  layout: PrintLayout; footerText?: string; qr?: boolean[][]; outW: number; outH: number
}
export interface ComposeResult { sheetUrl: string; thumbUrl: string; ms: { key: number; compose: number; layout: number; encode: number } }
export interface IngestResult { width: number; height: number; keyMs: number; readMs: number }
export interface RawResult { rawUrl: string; thumbUrl: string }
export interface HealthResult { coverage: number; edgeNoise: number; greenFrac: number }

export const NEEDRAW = 'NEEDRAW:'

const KEYED_MAX = 10
const keyed = new Map<string, Img>()
const held = new Map<string, ImageBitmap>()
const scenes = new Map<string, Img>()
let logo: Img | undefined

const touch = <V,>(m: Map<string, V>, k: string, v: V, max: number) => {
  m.delete(k); m.set(k, v)
  while (m.size > max) m.delete(m.keys().next().value as string)
}

async function decodeUrl(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob()
  return createImageBitmap(blob)
}

function pixelsOf(bmp: ImageBitmap, maxDim = 0): Img {
  let w = bmp.width, h = bmp.height
  if (maxDim && Math.max(w, h) > maxDim) { const k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k) }
  const oc = new OffscreenCanvas(w, h)
  const ctx = oc.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  return { data: d.data, width: w, height: h }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b) })
}
async function jpeg(src: OffscreenCanvas, q: number): Promise<string> {
  return blobToDataUrl(await src.convertToBlob({ type: 'image/jpeg', quality: q }))
}
async function thumbOf(src: ImageBitmap | OffscreenCanvas, maxSide: number, q = 0.7): Promise<string> {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height))
  const oc = new OffscreenCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)))
  oc.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, oc.width, oc.height)
  return jpeg(oc, q)
}

async function scenePixels(file: string, url: string): Promise<Img> {
  const hit = scenes.get(file)
  if (hit) { touch(scenes, file, hit, 14); return hit }
  const bmp = await decodeUrl(url)
  const px = pixelsOf(bmp, 1800); bmp.close()
  touch(scenes, file, px, 14)
  return px
}

type Op = (m: any) => Promise<unknown>
const ops: Record<string, Op> = {
  async init(m: { logo?: Img }) { logo = m.logo; return true },

  /** key a new frame (from a transferred ImageBitmap, or a url for reloads). The bitmap is kept for encodeRaw when `hold`. */
  async ingest(m: { cacheKey: string; bitmap?: ImageBitmap; url?: string; key: KeyParams; maxDim: number; hold?: boolean }): Promise<IngestResult> {
    const bmp = m.bitmap ?? await decodeUrl(m.url!)
    const t0 = performance.now()
    const px = pixelsOf(bmp, m.maxDim)
    const t1 = performance.now()
    touch(keyed, m.cacheKey, chromaKey(px, m.key) as Img, KEYED_MAX)
    const r: IngestResult = { width: bmp.width, height: bmp.height, readMs: t1 - t0, keyMs: performance.now() - t1 }
    if (m.hold) held.set(m.cacheKey, bmp); else bmp.close()
    return r
  },

  /** full-resolution JPEG of a held frame (for saving the raw shot); releases the bitmap */
  async encodeRaw(m: { cacheKey: string }): Promise<RawResult> {
    const bmp = held.get(m.cacheKey); if (!bmp) throw new Error('frame is gone')
    held.delete(m.cacheKey)
    const thumbUrl = await thumbOf(bmp, 360)
    const oc = new OffscreenCanvas(bmp.width, bmp.height)
    oc.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close()
    return { rawUrl: await jpeg(oc, 0.92), thumbUrl }
  },

  async compose(m: ComposeMsg): Promise<ComposeResult> {
    const t0 = performance.now()
    // re-key any frame that fell out of the cache (reloaded sessions, old items)
    for (const s of m.shots) {
      if (keyed.has(s.cacheKey)) { touch(keyed, s.cacheKey, keyed.get(s.cacheKey)!, KEYED_MAX); continue }
      if (!s.url) throw new Error(NEEDRAW + s.cacheKey)
      const bmp = await decodeUrl(s.url)
      touch(keyed, s.cacheKey, chromaKey(pixelsOf(bmp, m.keyMaxDim), m.key) as Img, KEYED_MAX); bmp.close()
    }
    const t1 = performance.now()
    const [bg, frame] = await Promise.all([scenePixels(m.scene.file, m.scene.url), m.frame ? scenePixels(m.frame.file, m.frame.url) : Promise.resolve(undefined)])
    const comps = m.shots.map(s => composeScene({ subject: keyed.get(s.cacheKey)!, scene: bg, anchor: m.scene.anchor, frame, outW: m.outW, outH: m.outH }))
    const t2 = performance.now()
    const sheet = layoutSheet(m.layout, comps, { logo: m.layout.showLogo ? logo : undefined, qr: m.qr, footerText: m.footerText })
    const t3 = performance.now()
    const oc = new OffscreenCanvas(sheet.width, sheet.height)
    oc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(sheet.data), sheet.width, sheet.height), 0, 0)
    const [sheetUrl, thumbUrl] = await Promise.all([jpeg(oc, 0.9), thumbOf(oc, 640, 0.78)])
    const t4 = performance.now()
    return { sheetUrl, thumbUrl, ms: { key: t1 - t0, compose: t2 - t1, layout: t3 - t2, encode: t4 - t3 } }
  },

  /** green-screen quality of a small live frame */
  async health(m: { bitmap: ImageBitmap; key: KeyParams }): Promise<HealthResult> {
    const px = pixelsOf(m.bitmap, 320); m.bitmap.close()
    const q = keyQuality(px, m.key)
    return { coverage: q.coverage, edgeNoise: q.edgeNoise, greenFrac: q.tips.some(t => /green is left/i.test(t)) ? 0.02 : 0 }
  },

  /** small jpeg preview of any image url (reloaded sessions) */
  async thumb(m: { url: string; max: number }): Promise<string> {
    const bmp = await decodeUrl(m.url)
    try { return await thumbOf(bmp, m.max) } finally { bmp.close() }
  },

  async forget(m: { prefix: string }) {
    for (const k of [...keyed.keys()]) if (k.startsWith(m.prefix)) keyed.delete(k)
    for (const [k, b] of [...held]) if (k.startsWith(m.prefix)) { b.close(); held.delete(k) }
    return true
  }
}

// operations run strictly in arrival order, so callers can fire ingest -> compose -> encodeRaw without awaiting each
let chain: Promise<unknown> = Promise.resolve()
export function handle(op: string, msg: unknown): Promise<unknown> {
  const run = () => { const f = ops[op]; if (!f) throw new Error('unknown op ' + op); return f(msg) }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}
