import type { RGBAImage } from '../keying/chromaKey'

export interface ComposeOpts {
  /** keyed subject (straight alpha) */
  subject: RGBAImage
  scene: RGBAImage
  /** x: horizontal centre 0..1 of canvas; y: bottom (feet) 0..1 of canvas; scale: subject height as fraction of canvas height */
  anchor: { x: number; y: number; scale: number }
  /** optional overlay with straight alpha, stretched to the canvas */
  frame?: RGBAImage
  outW: number
  outH: number
}

/** Bilinear sample (straight alpha) -> out[4]; coordinates in source pixels (pixel centres at +0.5). */
function sampleBilinear(src: RGBAImage, fx: number, fy: number, out: number[]): void {
  const { data, width: w, height: h } = src
  let x = fx - 0.5, y = fy - 0.5
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1
  const x0 = x | 0, y0 = y | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0
  const tx = x - x0, ty = y - y0
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty
  // premultiplied interpolation so transparent pixels do not bleed colour
  const a00 = data[i00 + 3] * w00, a10 = data[i10 + 3] * w10, a01 = data[i01 + 3] * w01, a11 = data[i11 + 3] * w11
  const a = a00 + a10 + a01 + a11
  if (a <= 0) { out[0] = out[1] = out[2] = out[3] = 0; return }
  for (let c = 0; c < 3; c++) {
    out[c] = (data[i00 + c] * a00 + data[i10 + c] * a10 + data[i01 + c] * a01 + data[i11 + c] * a11) / a
  }
  out[3] = a
}

/** Resample src (cover-fit) into a w*h opaque-ish image. */
function coverFit(src: RGBAImage, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  const s = Math.max(w / src.width, h / src.height)
  const ox = (src.width * s - w) / 2, oy = (src.height * s - h) / 2
  const px = [0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sampleBilinear(src, (x + ox + 0.5) / s, (y + oy + 0.5) / s, px)
      const j = (y * w + x) * 4
      out[j] = px[0]; out[j + 1] = px[1]; out[j + 2] = px[2]; out[j + 3] = 255
    }
  }
  return out
}

/** Separable box blur on a float plane (radius r, two passes ~ gaussian-ish). */
function blurPlane(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src
  let a = src
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(w * h)
    const win = 2 * r + 1
    for (let y = 0; y < h; y++) {
      let sum = 0
      const row = y * w
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win
        sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
      }
    }
    const out = new Float32Array(w * h)
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / win
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
      }
    }
    a = out
  }
  return a
}

export function composeScene(o: ComposeOpts): RGBAImage {
  const { subject, scene, anchor, frame, outW: W, outH: H } = o
  const out = coverFit(scene, W, H)
  const bg = new Uint8ClampedArray(out) // untouched scene copy for light wrap

  // Subject geometry: height = scale*H, width from aspect; bottom edge at y*H, centred on x*W.
  const sh = Math.max(1, anchor.scale * H)
  const sw = sh * (subject.width / subject.height)
  const left = anchor.x * W - sw / 2
  const top = anchor.y * H - sh
  const k = subject.width / sw // source px per out px

  // Rasterise subject into a canvas-sized layer (straight RGB + alpha float).
  const x0 = Math.max(0, Math.floor(left)), x1 = Math.min(W, Math.ceil(left + sw))
  const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(H, Math.ceil(top + sh))
  const layerA = new Float32Array(W * H)
  const layerRGB = new Uint8ClampedArray(W * H * 3)
  const px = [0, 0, 0, 0]
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sampleBilinear(subject, (x + 0.5 - left) * k, (y + 0.5 - top) * k, px)
      const i = y * W + x
      layerA[i] = px[3] / 255
      layerRGB[i * 3] = px[0]; layerRGB[i * 3 + 1] = px[1]; layerRGB[i * 3 + 2] = px[2]
    }
  }

  // Contact shadow: blurred alpha, squashed & offset below the feet, only near the bottom of the subject.
  const blurR = Math.max(2, Math.round(H * 0.012))
  const shadowSrc = new Float32Array(W * H)
  const shadowH = Math.max(4, sh * 0.06)
  const feet = Math.min(H - 1, Math.round(anchor.y * H))
  for (let y = Math.max(0, Math.round(feet - shadowH)); y <= feet; y++) {
    for (let x = x0; x < x1; x++) shadowSrc[y * W + x] = layerA[y * W + x]
  }
  const shadow = blurPlane(shadowSrc, W, H, blurR)
  const shadowOff = Math.round(blurR * 0.5)

  // Light wrap: blurred scene bleeds into subject edges where alpha is partial / near the border.
  const wrapR = Math.max(2, Math.round(H * 0.006))
  const inv = new Float32Array(W * H)
  for (let i = 0; i < inv.length; i++) inv[i] = 1 - layerA[i]
  const edgeness = blurPlane(inv, W, H, wrapR) // high near edges outside subject

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, j = i * 4
      // shadow, drawn under the subject (multiply toward black)
      const sy = y - shadowOff
      const sA = sy >= 0 ? shadow[sy * W + x] * 0.45 * (1 - layerA[i]) : 0
      if (sA > 0) {
        const f = 1 - sA
        out[j] *= f; out[j + 1] *= f; out[j + 2] *= f
      }
      const a = layerA[i]
      if (a <= 0) continue
      let r = layerRGB[i * 3], g = layerRGB[i * 3 + 1], b = layerRGB[i * 3 + 2]
      // light wrap strength: strongest in the outer part of the subject
      const wrap = Math.min(1, Math.max(0, (edgeness[i] - 0.15) * 1.2)) * 0.35 * a
      if (wrap > 0) {
        r += (bg[j] - r) * wrap; g += (bg[j + 1] - g) * wrap; b += (bg[j + 2] - b) * wrap
      }
      // alpha-over (opaque destination)
      out[j] = r * a + out[j] * (1 - a)
      out[j + 1] = g * a + out[j + 1] * (1 - a)
      out[j + 2] = b * a + out[j + 2] * (1 - a)
      out[j + 3] = 255
    }
  }

  if (frame) {
    const fp = [0, 0, 0, 0]
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        sampleBilinear(frame, ((x + 0.5) * frame.width) / W, ((y + 0.5) * frame.height) / H, fp)
        const j = (y * W + x) * 4
        const a = fp[3] / 255
        if (a <= 0) continue
        out[j] = fp[0] * a + out[j] * (1 - a)
        out[j + 1] = fp[1] * a + out[j + 1] * (1 - a)
        out[j + 2] = fp[2] * a + out[j + 2] * (1 - a)
      }
    }
  }
  return { data: out, width: W, height: H }
}
