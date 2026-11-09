// Pure post-processing for a model's soft person matte (values 0..1, n x n). No DOM: unit tested.

/** min-max normalise in place-ish (u2net output has no fixed range) */
export function normalizeMatte(out: ArrayLike<number>, n: number): Float32Array {
  const m = new Float32Array(n)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) { const v = out[i]; if (v < lo) lo = v; if (v > hi) hi = v }
  const range = hi - lo || 1
  for (let i = 0; i < n; i++) m[i] = (out[i] - lo) / range
  return m
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

/** Drop small disconnected blobs (background clutter the model half-believes in). Keeps every blob >= keepRatio of the biggest. */
export function dropIslands(m: Float32Array, w: number, h: number, keepRatio = 0.12, thr = 0.5): void {
  const label = new Int32Array(w * h)
  const sizes: number[] = [0]
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (label[s] || m[s] < thr) continue
    const id = sizes.length; let size = 0
    stack.push(s); label[s] = id
    while (stack.length) {
      const p = stack.pop()!; size++
      const x = p % w, y = (p - x) / w
      if (x > 0 && !label[p - 1] && m[p - 1] >= thr) { label[p - 1] = id; stack.push(p - 1) }
      if (x < w - 1 && !label[p + 1] && m[p + 1] >= thr) { label[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && !label[p - w] && m[p - w] >= thr) { label[p - w] = id; stack.push(p - w) }
      if (y < h - 1 && !label[p + w] && m[p + w] >= thr) { label[p + w] = id; stack.push(p + w) }
    }
    sizes.push(size)
  }
  const biggest = Math.max(0, ...sizes)
  if (!biggest) return
  const keep = sizes.map(s => s >= biggest * keepRatio)
  // zero out dropped blobs and the faint halo around them (anything within the blob's footprint grown by 2px)
  const drop = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) if (label[p] && !keep[label[p]]) drop[p] = 1
  for (let pass = 0; pass < 2; pass++) {
    const next = drop.slice()
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (!drop[p] && (drop[p - 1] || drop[p + 1] || drop[p - w] || drop[p + w]) && !(label[p] && keep[label[p]])) next[p] = 1
    }
    drop.set(next)
  }
  for (let p = 0; p < w * h; p++) if (drop[p]) m[p] = 0
}

/** Close small enclosed holes (a gap the model punched in a dark jacket or a dark sleeve). Holes touching the picture edge are real background. */
export function fillHoles(m: Float32Array, w: number, h: number, maxShare = 0.015, thr = 0.4): void {
  const seen = new Uint8Array(w * h) // 1 = background connected to the edge
  const stack: number[] = []
  const push = (p: number) => { if (!seen[p] && m[p] < thr) { seen[p] = 1; stack.push(p) } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()!, x = p % w
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < w * h - w) push(p + w)
  }
  // label the remaining low pixels (enclosed holes) and fill the small ones
  const lab = new Uint8Array(w * h)
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || lab[s] || m[s] >= thr) continue
    const cells: number[] = []; stack.push(s); lab[s] = 1
    while (stack.length) {
      const p = stack.pop()!; cells.push(p); const x = p % w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * h - w ? p + w : -1]
      for (const q of nb) if (q >= 0 && !seen[q] && !lab[q] && m[q] < thr) { lab[q] = 1; stack.push(q) }
    }
    if (cells.length <= maxShare * w * h) for (const p of cells) m[p] = 1
  }
}

/** Tighten the soft model output into a cleaner matte: islands out, then a contrast curve so the fringe is crisp but still feathered. */
export function refineMatte(raw: ArrayLike<number>, w: number, h: number, opts: { lo?: number; hi?: number } = {}): Float32Array {
  const m = normalizeMatte(raw, w * h)
  dropIslands(m, w, h)
  fillHoles(m, w, h)
  // the model is timid on dark clothes: a low, early curve keeps the body solid; the edge stays soft
  const lo = opts.lo ?? 0.02, hi = opts.hi ?? 0.3
  for (let i = 0; i < m.length; i++) m[i] = smooth(lo, hi, m[i])
  return m
}
