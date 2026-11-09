// Shared "how do we remove this background?" logic. PURE (no DOM, no window.booth): the kiosk, the staff pipeline and the
// tests all use it. KeyParams.mode:
//   'chroma' -> green key only        'ai' -> ai cutout only
//   'auto'   -> green key first, with the stage (the part of the picture that is really green screen) found automatically.
//               no green screen at all, or a poor key -> ai.  Clutter left at the frame edges (camera sees past the screen
//               and autoStage can't trim it, e.g. a wall patch in one corner) -> hybrid: chroma alpha x ai garbage matte.
import { chromaKey, keyQuality } from '@core/index'
import type { KeyParams } from '../../shared/types'

export interface Px { data: Uint8ClampedArray; width: number; height: number }
export type Engine = 'chroma' | 'ai' | 'hybrid'
export type Stage = NonNullable<KeyParams['stage']>

/** below this share of green-ish pixels on the stage border we assume there is no green screen in the picture */
export const NO_GREEN_BORDER = 0.15
export const AI_TIMEOUT_MS = 8000
/** opaque non-subject blobs touching the frame edge beyond this share of the frame trigger the hybrid cleanup */
export const LEFTOVER_LIMIT = 0.015
const STAGE_MAX = 0.45

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

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

/** crop to the stage rectangle (fractions of each edge) */
export function cropToStage(img: Px, st?: Stage): Px {
  if (!st) return img
  const x0 = Math.round(clamp(st.left, 0, STAGE_MAX) * img.width), x1 = img.width - Math.round(clamp(st.right, 0, STAGE_MAX) * img.width)
  const y0 = Math.round(clamp(st.top, 0, STAGE_MAX) * img.height), y1 = img.height - Math.round(clamp(st.bottom, 0, STAGE_MAX) * img.height)
  const w = x1 - x0, h = y1 - y0
  if (w < 4 || h < 4) return img
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4), y * w * 4)
  return { data: out, width: w, height: h }
}

type Params = Pick<KeyParams, 'keyColor' | 'similarity'>
/** per-pixel "this looks like the green screen" test: close to keyColor in chroma AND clearly green (lighting falls off at screen edges, so a bit forgiving) */
function greenTest(p: Params) {
  const [kr, kg, kb] = p.keyColor
  const kcb = 128 - 0.168736 * kr - 0.331264 * kg + 0.5 * kb
  const kcr = 128 + 0.5 * kr - 0.418688 * kg - 0.081312 * kb
  const lim = (Math.max(0.1, p.similarity) * 0.4 + 0.06) * 255
  return (data: Uint8ClampedArray, j: number) => {
    const r = data[j], g = data[j + 1], b = data[j + 2]
    if (g - (r > b ? r : b) < 12) return false
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    return Math.hypot(cb - kcb, cr - kcr) <= lim
  }
}

/** Share of border pixels (8% band on all four sides) that look like the green screen. */
export function greenBorderFraction(img: Px, p: Params): number {
  const { data, width: w, height: h } = img
  if (w < 4 || h < 4) return 0
  const isGreen = greenTest(p)
  const bx = Math.max(1, Math.round(w * 0.08)), by = Math.max(1, Math.round(h * 0.08))
  let near = 0, n = 0
  for (let y = 0; y < h; y++) {
    const edgeRow = y < by || y >= h - by
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= bx && x < w - bx) { x = w - bx - 1; continue }
      n++
      if (isGreen(data, (y * w + x) * 4)) near++
    }
  }
  return n ? near / n : 0
}

/**
 * Find where the green screen actually is. The camera often sees past the screen (wall, ceiling, a dark corner):
 * trim edge rows/columns that are mostly NOT green (>75%), repeatedly, up to 45% per side, then add a small safety inset.
 * undefined = the border is already green (nothing to trim) or no credible screen was found.
 * The bottom edge is never trimmed automatically (that is where people's bodies cross the frame); set it by hand in admin if needed.
 */
export function autoStage(frame: Px, params: Params): Stage | undefined {
  const img = subsample(frame, 200)
  const { data, width: w, height: h } = img
  const isGreen = greenTest(params)
  const g = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = isGreen(data, i * 4) ? 1 : 0
  let l = 0, r = w, t = 0, b = h
  const maxX = Math.floor(w * STAGE_MAX), maxY = Math.floor(h * STAGE_MAX)
  const colGreen = (x: number) => { let n = 0; for (let y = t; y < b; y++) n += g[y * w + x]; return n / Math.max(1, b - t) }
  const rowGreen = (y: number) => { let n = 0; for (let x = l; x < r; x++) n += g[y * w + x]; return n / Math.max(1, r - l) }
  // trim a line only when it is overwhelmingly NOT green (wall / ceiling are ~100%; a tall guest near the edge must not be trimmed)
  const NON = 0.75
  for (let pass = 0; pass < 6; pass++) {
    let moved = false
    while (l < maxX && colGreen(l) < 1 - NON) { l++; moved = true }
    while (w - r < maxX && colGreen(r - 1) < 1 - NON) { r--; moved = true }
    while (t < maxY && rowGreen(t) < 1 - NON) { t++; moved = true }
    // no bottom trim: guests' bodies cross the bottom edge, and a hard cut there is worse than leftovers (the hybrid cleanup handles those)
    if (!moved) break
  }
  const st = { left: l / w, right: (w - r) / w, top: t / h, bottom: (h - b) / h }
  const trimmed = Math.max(st.left, st.right, st.top, st.bottom)
  if (trimmed < 0.012) return undefined
  if (r - l < w * 0.3 || b - t < h * 0.3) return undefined   // nothing credible left: no screen in this picture
  const inset = 0.015
  const f = (v: number) => (v > 0.004 ? clamp(v + inset, 0, STAGE_MAX) : 0)
  return { left: f(st.left), right: f(st.right), top: f(st.top), bottom: f(st.bottom) }
}

/** which sides of the picture lack green screen, in words ('top and left'); '' when none */
export function stageGapSides(st?: Stage, min = 0.04): string[] {
  if (!st) return []
  const out: string[] = []
  if (st.top >= min) out.push('top'); if (st.left >= min) out.push('left'); if (st.right >= min) out.push('right'); if (st.bottom >= min) out.push('bottom')
  return out
}
export const join = (a: string[]) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1])

/** the settings' stage wins; otherwise (auto mode only) the detected one */
export function effectiveKey(frame: Px, p: KeyParams): KeyParams {
  if (p.mode !== 'auto' || p.stage) return p
  const stage = autoStage(frame, p)
  return stage ? { ...p, stage } : p
}

/**
 * Opaque, non-subject blobs that touch the frame edge, as a share of the frame. The subject = the biggest blob (plus other big
 * blobs standing on the bottom edge: more people). What's left over is wall / ceiling / dark corner that the green key kept.
 */
export function leftoverShare(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, stride = 4, off = 3): number {
  const lab = new Int32Array(w * h)
  const sizes: number[] = [0]
  const touches: boolean[] = [false]
  const onBottom: boolean[] = [false]
  const stack: number[] = []
  const on = (p: number) => alpha[p * stride + off] > 127
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || !on(s)) continue
    const id = sizes.length; let size = 0, edge = false, bottom = false
    stack.push(s); lab[s] = id
    while (stack.length) {
      const p = stack.pop()!; size++
      const x = p % w, y = (p - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true
      if (y === h - 1) bottom = true
      if (x > 0 && !lab[p - 1] && on(p - 1)) { lab[p - 1] = id; stack.push(p - 1) }
      if (x < w - 1 && !lab[p + 1] && on(p + 1)) { lab[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && !lab[p - w] && on(p - w)) { lab[p - w] = id; stack.push(p - w) }
      if (y < h - 1 && !lab[p + w] && on(p + w)) { lab[p + w] = id; stack.push(p + w) }
    }
    sizes.push(size); touches.push(edge); onBottom.push(bottom)
  }
  const biggest = Math.max(0, ...sizes)
  let left = 0
  for (let id = 1; id < sizes.length; id++) {
    if (sizes[id] === biggest || !touches[id]) continue
    if (onBottom[id] && sizes[id] > biggest * 0.25) continue // another person
    left += sizes[id]
  }
  return left / (w * h)
}

/** Cheap look at a frame: where is the green backdrop, how well does the key work, what is left over at the edges. */
export interface BackdropReport {
  /** 0..1 share of the stage's outer border that is close to the key colour */
  greenBorderFrac: number
  /** 0..1 share of the frame the green key removes */
  coverage: number
  edgeNoise: number
  /** true when the key result is not usable (almost nothing removed, almost everything removed, or very ragged) */
  poor: boolean
  /** share of the frame that is non-green clutter touching the frame edge after keying */
  leftover: number
  /** the stage that was analysed (settings or auto-detected) */
  stage?: Stage
  /** sides where the camera sees past the screen, e.g. ['top','left'] */
  gaps: string[]
}

export function analyzeBackdrop(img: Px, p: KeyParams): BackdropReport {
  const small = subsample(img)
  const eff = effectiveKey(small, p)
  const q = keyQuality(small, eff)
  const keyed = chromaKey(small, eff)
  const poor = q.coverage < 0.08 || q.coverage > 0.92 || q.edgeNoise > 0.45
  const detected = p.mode === 'auto' && !p.stage ? eff.stage : undefined
  return {
    greenBorderFrac: greenBorderFraction(cropToStage(small, eff.stage), p),
    coverage: q.coverage, edgeNoise: q.edgeNoise, poor,
    leftover: leftoverShare(keyed.data, keyed.width, keyed.height),
    stage: eff.stage, gaps: stageGapSides(detected)
  }
}

export interface KeyDecision { engine: Engine; reason: string }
type ReportLite = Pick<BackdropReport, 'greenBorderFrac' | 'poor'> & Partial<Pick<BackdropReport, 'leftover'>>

/** The decision rule. For 'auto' it needs the report from running the green key first; without one we stay on green. */
export function chooseKeyer(mode: KeyParams['mode'], report?: ReportLite): KeyDecision {
  if (mode === 'chroma') return { engine: 'chroma', reason: 'green screen key' }
  if (mode === 'ai') return { engine: 'ai', reason: 'ai cutout' }
  if (!report) return { engine: 'chroma', reason: 'green screen key' }
  if (report.greenBorderFrac < NO_GREEN_BORDER) return { engine: 'ai', reason: 'no green screen found, so we cut you out with ai' }
  if (report.poor) return { engine: 'ai', reason: 'the green screen looked patchy, so we cut you out with ai' }
  if ((report.leftover ?? 0) > LEFTOVER_LIMIT) return { engine: 'hybrid', reason: 'something outside the green screen was in the picture, so ai tidied the edges' }
  return { engine: 'chroma', reason: 'green screen key' }
}

/** share of pixels that are mostly opaque (0..1) */
export function opaqueShare(img: Px): number {
  let n = 0
  const total = img.width * img.height
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 127) n++
  return total ? n / total : 0
}

/** chroma alpha x dilated ai alpha (ai = garbage matte; the green key keeps its clean edges around the subject). Same-size inputs. */
export function combineGarbage(chroma: Px, ai: Px, radius?: number): Px {
  const { width: w, height: h } = chroma
  const r = radius ?? Math.max(2, Math.round(Math.max(w, h) * 0.012))
  // separable max filter (dilate) then a 3-tap blur, on the ai alpha
  let a = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) a[i] = ai.data[i * 4 + 3]
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
    for (let k = x0; k <= x1; k++) { const v = a[y * w + k]; if (v > m) m = v }
    tmp[y * w + x] = m
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
    for (let k = y0; k <= y1; k++) { const v = tmp[k * w + x]; if (v > m) m = v }
    a[y * w + x] = m
  }
  const out = new Uint8ClampedArray(chroma.data)
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = (chroma.data[i * 4 + 3] * a[i] + 127) / 255
  return { data: out, width: w, height: h }
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
  if (opaqueShare(out) < 0.02) throw new Error('ai could not find a person')
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

  const eff = effectiveKey(img, params)
  const keyed = chroma(img, eff)
  if (params.mode === 'chroma') return { image: keyed, engineUsed: 'chroma', reason: 'green screen key' }

  let report: BackdropReport | undefined
  try { report = analyzeBackdrop(img, params) } catch { report = undefined }
  const d = chooseKeyer('auto', report)
  if (d.engine === 'chroma') return { image: keyed, engineUsed: 'chroma', reason: d.reason, report }
  try {
    const t = performance.now()
    const ai = await runAi(img, engines)
    const image = d.engine === 'hybrid' ? combineGarbage(keyed, ai) : ai
    return { image, engineUsed: d.engine, reason: d.reason, report, aiMs: performance.now() - t }
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

/** the friendly line for the pose screen / lineup, or '' when the picture is fine */
export function liveHint(mode: KeyParams['mode'], report?: Pick<BackdropReport, 'greenBorderFrac' | 'gaps'>): string {
  if (!report || mode === 'chroma') return ''
  if (report.greenBorderFrac < NO_GREEN_BORDER) return 'no green screen detected — we’ll cut you out with ai after the photo'
  if (report.gaps.length) return `your green screen doesn’t fill the picture on the ${join(report.gaps)} — move closer, zoom in, or tell staff`
  return ''
}
