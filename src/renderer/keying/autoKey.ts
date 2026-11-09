// Shared "how do we remove this background?" logic. PURE (no DOM, no window.booth): the kiosk, the staff pipeline and the
// tests all use it. KeyParams.mode:
//   'chroma' -> green key only        'ai' -> ai cutout only
//   'auto'   -> green key first; if there is no green backdrop at all (a phone in a living room) or the key is poor, ai.
import { chromaKey, keyQuality } from '@core/index'
import type { KeyParams } from '../../shared/types'

export interface Px { data: Uint8ClampedArray; width: number; height: number }
export type Engine = 'chroma' | 'ai'

/** below this share of green-ish border pixels we assume there is no green screen in the picture */
export const NO_GREEN_BORDER = 0.15
export const AI_TIMEOUT_MS = 8000

/** Cheap look at a frame: is there a green backdrop, and how well does the green key work on it? */
export interface BackdropReport {
  /** 0..1 share of the frame's outer border that is close to the key colour */
  greenBorderFrac: number
  /** 0..1 share of the frame the green key removes */
  coverage: number
  edgeNoise: number
  /** true when the key result is not usable (almost nothing removed, almost everything removed, or very ragged) */
  poor: boolean
}

/** every ~Nth pixel so analysis stays ~constant cost whatever the camera resolution */
export function subsample(img: Px, maxSide = 320): Px {
  const step = Math.max(1, Math.floor(Math.max(img.width, img.height) / maxSide))
  if (step === 1) return img
  const w = Math.floor(img.width / step), h = Math.floor(img.height / step)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y * step) * img.width + x * step) * 4, d = (y * w + x) * 4
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

/** Share of border pixels (8% band on all four sides) that look like the green screen: close to keyColor in chroma AND clearly green. */
export function greenBorderFraction(img: Px, p: Pick<KeyParams, 'keyColor' | 'similarity'>): number {
  const { data, width: w, height: h } = img
  if (w < 4 || h < 4) return 0
  const [kr, kg, kb] = p.keyColor
  const kcb = 128 - 0.168736 * kr - 0.331264 * kg + 0.5 * kb
  const kcr = 128 + 0.5 * kr - 0.418688 * kg - 0.081312 * kb
  // a bit more forgiving than the matte itself (lighting falls off towards the edges of a screen)
  const lim = (Math.max(0.1, p.similarity) * 0.4 + 0.06) * 255
  const bx = Math.max(1, Math.round(w * 0.08)), by = Math.max(1, Math.round(h * 0.08))
  let near = 0, n = 0
  for (let y = 0; y < h; y++) {
    const edgeRow = y < by || y >= h - by
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= bx && x < w - bx) { x = w - bx - 1; continue }
      const j = (y * w + x) * 4
      const r = data[j], g = data[j + 1], b = data[j + 2]
      n++
      if (g - (r > b ? r : b) < 12) continue
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
      if (Math.hypot(cb - kcb, cr - kcr) <= lim) near++
    }
  }
  return n ? near / n : 0
}

export function analyzeBackdrop(img: Px, p: KeyParams): BackdropReport {
  const small = subsample(img)
  const q = keyQuality(small, p)
  const poor = q.coverage < 0.08 || q.coverage > 0.92 || q.edgeNoise > 0.45
  return { greenBorderFrac: greenBorderFraction(small, p), coverage: q.coverage, edgeNoise: q.edgeNoise, poor }
}

export interface KeyDecision { engine: Engine; reason: string }

/** The decision rule. For 'auto' it needs the report from running the green key first; without one we stay on green. */
export function chooseKeyer(mode: KeyParams['mode'], report?: Pick<BackdropReport, 'greenBorderFrac' | 'poor'>): KeyDecision {
  if (mode === 'chroma') return { engine: 'chroma', reason: 'green screen key' }
  if (mode === 'ai') return { engine: 'ai', reason: 'ai cutout' }
  if (!report) return { engine: 'chroma', reason: 'green screen key' }
  if (report.greenBorderFrac < NO_GREEN_BORDER) return { engine: 'ai', reason: 'no green screen found, so we cut you out with ai' }
  if (report.poor) return { engine: 'ai', reason: 'the green screen looked patchy, so we cut you out with ai' }
  return { engine: 'chroma', reason: 'green screen key' }
}

/** share of pixels that are mostly opaque (0..1) */
export function opaqueShare(img: Px): number {
  let n = 0
  const total = img.width * img.height
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 127) n++
  return total ? n / total : 0
}

export interface KeyEngines {
  /** defaults to the shared core chroma key */
  chroma?: (img: Px, p: KeyParams) => Px
  /** returns the same picture with the person's alpha (same size). Reject/throw when unavailable. */
  ai?: (img: Px) => Promise<Px>
  /** only needed when keyFrame is handed a data url */
  decode?: (url: string) => Promise<Px>
  aiTimeoutMs?: number
}
export interface KeyResult { image: Px; engineUsed: Engine; reason: string; report?: BackdropReport; aiMs?: number }

function timeBox<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`took longer than ${Math.round(ms / 1000)}s`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Run the AI engine with a time box and sanity checks. Resolves the keyed picture or throws a short plain-english reason. */
async function runAi(img: Px, e: KeyEngines): Promise<Px> {
  if (!e.ai) throw new Error('ai cutout is not available here')
  const out = await timeBox(Promise.resolve().then(() => e.ai!(img)), e.aiTimeoutMs ?? AI_TIMEOUT_MS)
  if (!out || out.width !== img.width || out.height !== img.height) throw new Error('ai returned a different size')
  const share = opaqueShare(out)
  if (share < 0.02) throw new Error('ai could not find a person')
  return out
}

/**
 * Key one frame. NEVER throws: when ai is unavailable / too slow / finds nobody, the green-key result is returned and
 * `reason` says so (UIs can show it). `engineUsed` is what actually produced `image`.
 */
export async function keyFrame(input: Px | string, params: KeyParams, engines: KeyEngines = {}): Promise<KeyResult> {
  const chroma = engines.chroma ?? ((i: Px, p: KeyParams) => chromaKey(i, p) as Px)
  let img: Px
  try {
    if (typeof input === 'string') {
      if (!engines.decode) throw new Error('no decoder')
      img = await engines.decode(input)
    } else img = input
  } catch (e) {
    return { image: { data: new Uint8ClampedArray(4), width: 1, height: 1 }, engineUsed: 'chroma', reason: `could not read the picture (${msg(e)})` }
  }

  if (params.mode === 'ai') {
    try {
      const t = performance.now()
      return { image: await runAi(img, engines), engineUsed: 'ai', reason: 'ai cutout', aiMs: performance.now() - t }
    } catch (e) {
      return { image: chroma(img, params), engineUsed: 'chroma', reason: `ai cutout failed (${msg(e)}), used the green screen key instead` }
    }
  }

  const keyed = chroma(img, params)
  if (params.mode === 'chroma') return { image: keyed, engineUsed: 'chroma', reason: 'green screen key' }

  let report: BackdropReport | undefined
  try { report = analyzeBackdrop(img, params) } catch { report = undefined }
  const d = chooseKeyer('auto', report)
  if (d.engine === 'chroma') return { image: keyed, engineUsed: 'chroma', reason: d.reason, report }
  try {
    const t = performance.now()
    return { image: await runAi(img, engines), engineUsed: 'ai', reason: d.reason, report, aiMs: performance.now() - t }
  } catch (e) {
    return { image: keyed, engineUsed: 'chroma', reason: `${d.reason}, but ai cutout failed (${msg(e)}), so we used the green screen key`, report }
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Live-preview helper: true when the feed has no green backdrop and the mode will fall back to ai after the photo. */
export function needsAiHint(mode: KeyParams['mode'], report?: Pick<BackdropReport, 'greenBorderFrac'>): boolean {
  if (mode === 'chroma' || !report) return false
  return report.greenBorderFrac < NO_GREEN_BORDER
}
