import type { KeyParams } from '../../shared/types'

export interface RGBAImage { data: Uint8ClampedArray; width: number; height: number }

// BT.601 full-range chroma of the key colour.
export function rgbToCbCr(r: number, g: number, b: number): [number, number] {
  return [
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ]
}

/** Matte thresholds shared by the CPU keyer and the GLSL preview (distances normalised by 255). */
export function matteThresholds(p: KeyParams): { t0: number; t1: number } {
  const t0 = Math.max(0, p.similarity) * 0.4
  const width = Math.max(0.0005, p.smoothness * 0.5)
  return { t0, t1: t0 + width }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Raw soft matte (0..255) from chroma distance. */
function rawMatte(img: RGBAImage, p: KeyParams): Uint8Array {
  const { data, width, height } = img
  const n = width * height
  const a = new Uint8Array(n)
  const [kcb, kcr] = rgbToCbCr(p.keyColor[0], p.keyColor[1], p.keyColor[2])
  const { t0, t1 } = matteThresholds(p)
  const inv = 1 / (t1 - t0)
  const s = 1 / 255
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2]
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    const dcb = cb - kcb, dcr = cr - kcr
    const d = Math.sqrt(dcb * dcb + dcr * dcr) * s
    let t = (d - t0) * inv
    t = t < 0 ? 0 : t > 1 ? 1 : t
    t = t * t * (3 - 2 * t)
    a[i] = (t * 255 + 0.5) | 0
    // Multiply by the source alpha later if ever needed; camera frames are opaque.
  }
  return a
}

/** Square-kernel erosion (min filter), separable. radius in whole pixels. */
function erode(a: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return a
  const tmp = new Uint8Array(a.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const x0 = x - r < 0 ? 0 : x - r, x1 = x + r >= w ? w - 1 : x + r
      let m = 255
      for (let k = x0; k <= x1; k++) { const v = a[row + k]; if (v < m) m = v }
      tmp[row + x] = m
    }
  }
  const out = new Uint8Array(a.length)
  for (let y = 0; y < h; y++) {
    const y0 = y - r < 0 ? 0 : y - r, y1 = y + r >= h ? h - 1 : y + r
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let k = y0; k <= y1; k++) { const v = tmp[k * w + x]; if (v < m) m = v }
      out[y * w + x] = m
    }
  }
  return out
}

/** Remove tiny opaque islands and fill tiny interior holes (in place). */
function cleanup(a: Uint8Array, w: number, h: number): void {
  const n = w * h
  const minIsland = Math.max(64, Math.round(n * 0.0004))
  const minHole = Math.max(32, Math.round(n * 0.0001))
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue
    const fg = a[s] >= 128
    let head = 0, tail = 0, border = false
    queue[tail++] = s; seen[s] = 1
    while (head < tail) {
      const i = queue[head++]
      const x = i % w, y = (i - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true
      if (x > 0) { const k = i - 1; if (!seen[k] && (a[k] >= 128) === fg) { seen[k] = 1; queue[tail++] = k } }
      if (x < w - 1) { const k = i + 1; if (!seen[k] && (a[k] >= 128) === fg) { seen[k] = 1; queue[tail++] = k } }
      if (y > 0) { const k = i - w; if (!seen[k] && (a[k] >= 128) === fg) { seen[k] = 1; queue[tail++] = k } }
      if (y < h - 1) { const k = i + w; if (!seen[k] && (a[k] >= 128) === fg) { seen[k] = 1; queue[tail++] = k } }
    }
    if (fg && tail < minIsland) for (let q = 0; q < tail; q++) a[queue[q]] = 0
    else if (!fg && !border && tail < minHole) for (let q = 0; q < tail; q++) a[queue[q]] = 255
  }
}

/** Key a green screen out of `img`. Returns a new RGBA image (straight alpha). */
export function chromaKey(img: RGBAImage, p: KeyParams): RGBAImage {
  const { width: w, height: h } = img
  const n = w * h
  let a = rawMatte(img, p)
  const shrink = Math.max(0, Math.min(4, p.edgeShrink))
  const rInt = Math.floor(shrink), frac = shrink - rInt
  if (shrink > 0) {
    const e1 = erode(a, w, h, rInt)
    if (frac > 0.01) {
      const e2 = erode(a, w, h, rInt + 1)
      const mixed = new Uint8Array(n)
      for (let i = 0; i < n; i++) mixed[i] = e1[i] + (e2[i] - e1[i]) * frac
      a = mixed
    } else a = e1 === a ? a : e1
  }
  cleanup(a, w, h)

  const out = new Uint8ClampedArray(img.data)
  const k = Math.min(1, Math.max(0, p.spill) * 2)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const al = a[i]
    out[j + 3] = al
    if (al === 0 || k === 0) continue
    const r = out[j], g = out[j + 1], b = out[j + 2]
    const lim = r > b ? r : b
    if (g > lim) out[j + 1] = g - (g - lim) * k
  }
  return { data: out, width: w, height: h }
}

/** Estimate the screen colour by taking the median of strongly-green pixels (border first). */
export function autoCalibrate(img: RGBAImage): [number, number, number] {
  const { data, width: w, height: h } = img
  const border: number[][] = [[], [], []]
  const all: number[][] = [[], [], []]
  const bx = Math.max(1, Math.round(w * 0.06)), by = Math.max(1, Math.round(h * 0.06))
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)))
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const j = (y * w + x) * 4
      const r = data[j], g = data[j + 1], b = data[j + 2]
      if (g - (r > b ? r : b) < 25) continue
      const isBorder = x < bx || y < by || x >= w - bx || y >= h - by
      all[0].push(r); all[1].push(g); all[2].push(b)
      if (isBorder) { border[0].push(r); border[1].push(g); border[2].push(b) }
    }
  }
  const src = border[0].length >= 30 ? border : all
  if (src[0].length === 0) return [0, 177, 64]
  const med = (arr: number[]) => { arr.sort((x, y) => x - y); return arr[arr.length >> 1] }
  return [med(src[0]), med(src[1]), med(src[2])]
}

export interface KeyQuality { coverage: number; edgeNoise: number; ok: boolean; tips: string[] }

/** Diagnostics for the admin screen. Tips are plain english. */
export function keyQuality(img: RGBAImage, p: KeyParams): KeyQuality {
  const out = chromaKey(img, p)
  const n = out.width * out.height
  let bg = 0, semi = 0, greenLeft = 0, opaque = 0
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = out.data[j + 3]
    if (a < 16) bg++
    else if (a < 240) semi++
    else {
      opaque++
      const r = out.data[j], g = out.data[j + 1], b = out.data[j + 2]
      if (g - (r > b ? r : b) > 40) greenLeft++
    }
  }
  const coverage = bg / n
  const edgeNoise = semi / Math.max(1, bg + semi)
  const greenFrac = opaque ? greenLeft / opaque : 0
  const tips: string[] = []
  if (coverage < 0.1) tips.push('Very little green was removed. Click "sample green" on an empty part of the screen or raise Similarity.')
  if (coverage > 0.9) tips.push('Almost the whole picture was removed. Lower Similarity, and check the guest is not wearing green.')
  if (greenFrac > 0.01) tips.push('Some green is left in the picture. Raise Similarity a little, or light the screen more evenly.')
  if (edgeNoise > 0.3) tips.push('Edges look fuzzy. Light the screen evenly, move guests away from it, or lower Smoothness.')
  if (edgeNoise < 0.01 && coverage > 0.1 && coverage <= 0.9) tips.push('Edges are very hard. Raise Smoothness slightly for a more natural look.')
  return { coverage, edgeNoise, ok: tips.length === 0, tips }
}

export { clamp01 }
