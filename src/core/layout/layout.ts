import type { PrintLayout, PrintSize } from '../../shared/types'
import type { RGBAImage } from '../keying/chromaKey'
import { renderText } from './text'

/** Exact output pixel sizes at 300 dpi (portrait). For 2x6-strip the sheet is 4x6 holding two 2x6 strips. */
export const PRINT_PX: Record<PrintSize, { w: number; h: number }> = {
  '4x6': { w: 1200, h: 1800 },
  '5x7': { w: 1500, h: 2100 },
  '6x8': { w: 1800, h: 2400 },
  '2x6-strip': { w: 1200, h: 1800 },
}

export interface LayoutOpts { logo?: RGBAImage; footerText?: string; qr?: boolean[][] }

interface Rect { x: number; y: number; w: number; h: number }

/** Blit src into dest rect, cover-fit (centre crop) or contain-fit, bilinear, alpha-over onto opaque dest. */
function blit(dest: Uint8ClampedArray, dw: number, src: RGBAImage, r: Rect, mode: 'cover' | 'contain'): void {
  const s = mode === 'cover' ? Math.max(r.w / src.width, r.h / src.height) : Math.min(r.w / src.width, r.h / src.height)
  const rw = src.width * s, rh = src.height * s
  const ox = r.x + (r.w - rw) / 2, oy = r.y + (r.h - rh) / 2
  const x0 = Math.max(r.x, Math.floor(ox)), x1 = Math.min(r.x + r.w, Math.ceil(ox + rw))
  const y0 = Math.max(r.y, Math.floor(oy)), y1 = Math.min(r.y + r.h, Math.ceil(oy + rh))
  const { data, width: sw, height: sh } = src
  // For downscales use a small box average to avoid aliasing
  const step = 1 / s
  const taps = step > 1.5 ? Math.min(4, Math.ceil(step / 1.5)) : 1
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0
      for (let ty = 0; ty < taps; ty++) {
        for (let tx = 0; tx < taps; tx++) {
          let fx = (x + (tx + 0.5) / taps - ox) * step - 0.5
          let fy = (y + (ty + 0.5) / taps - oy) * step - 0.5
          fx = fx < 0 ? 0 : fx > sw - 1 ? sw - 1 : fx
          fy = fy < 0 ? 0 : fy > sh - 1 ? sh - 1 : fy
          const ix = fx | 0, iy = fy | 0
          const jx = ix + 1 < sw ? ix + 1 : ix, jy = iy + 1 < sh ? iy + 1 : iy
          const tX = fx - ix, tY = fy - iy
          const i00 = (iy * sw + ix) * 4, i10 = (iy * sw + jx) * 4, i01 = (jy * sw + ix) * 4, i11 = (jy * sw + jx) * 4
          const w00 = (1 - tX) * (1 - tY), w10 = tX * (1 - tY), w01 = (1 - tX) * tY, w11 = tX * tY
          const a00 = data[i00 + 3] * w00, a10 = data[i10 + 3] * w10, a01 = data[i01 + 3] * w01, a11 = data[i11 + 3] * w11
          const a = a00 + a10 + a01 + a11
          ar += data[i00] * a00 + data[i10] * a10 + data[i01] * a01 + data[i11] * a11
          ag += data[i00 + 1] * a00 + data[i10 + 1] * a10 + data[i01 + 1] * a01 + data[i11 + 1] * a11
          ab += data[i00 + 2] * a00 + data[i10 + 2] * a10 + data[i01 + 2] * a01 + data[i11 + 2] * a11
          aa += a
        }
      }
      const n = taps * taps
      if (aa <= 0) continue
      const alpha = aa / n / 255
      const j = (y * dw + x) * 4
      dest[j] = ar / aa * alpha + dest[j] * (1 - alpha)
      dest[j + 1] = ag / aa * alpha + dest[j + 1] * (1 - alpha)
      dest[j + 2] = ab / aa * alpha + dest[j + 2] * (1 - alpha)
    }
  }
}

function drawQr(dest: Uint8ClampedArray, dw: number, qr: boolean[][], box: Rect): void {
  const n = qr.length
  const quiet = 2
  const mod = Math.max(1, Math.floor(Math.min(box.w, box.h) / (n + quiet * 2)))
  const size = mod * (n + quiet * 2)
  const ox = box.x + box.w - size, oy = box.y + Math.floor((box.h - size) / 2)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / mod) - quiet, my = Math.floor(y / mod) - quiet
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr[my][mx]
      const j = ((oy + y) * dw + ox + x) * 4
      const v = dark ? 0 : 255
      dest[j] = v; dest[j + 1] = v; dest[j + 2] = v; dest[j + 3] = 255
    }
  }
}

/** Grid for N photos in a panel: 1 -> 1x1, 2 -> 1 col x 2 rows, 3 -> 1x3, 4 -> 2x2 (strip panels are always a single column). */
function gridFor(n: number, singleColumn: boolean): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 }
  if (n === 4 && !singleColumn) return { cols: 2, rows: 2 }
  return { cols: 1, rows: n }
}

function renderPanel(
  dest: Uint8ClampedArray, dw: number, panel: Rect, layout: PrintLayout,
  photos: RGBAImage[], opts: LayoutOpts, singleColumn: boolean,
): void {
  const margin = Math.round(Math.min(panel.w, panel.h) * 0.04)
  const gap = Math.max(2, Math.round(margin * 0.6))
  const wantLogo = layout.showLogo && !!opts.logo
  const wantText = !!layout.footerText || !!opts.footerText
  const wantQr = layout.qrCode && !!opts.qr
  const footerH = wantLogo || wantText || wantQr ? Math.round(panel.h * (singleColumn ? 0.1 : 0.085)) : 0
  const area: Rect = {
    x: panel.x + margin, y: panel.y + margin,
    w: panel.w - margin * 2, h: panel.h - margin * 2 - (footerH ? footerH + gap : 0),
  }
  const count = Math.max(1, Math.min(4, layout.photosPerSheet))
  const { cols, rows } = gridFor(count, singleColumn)
  const cw = Math.floor((area.w - gap * (cols - 1)) / cols), ch = Math.floor((area.h - gap * (rows - 1)) / rows)
  if (photos.length) {
    for (let i = 0; i < count; i++) {
      const c = i % cols, r = Math.floor(i / cols)
      blit(dest, dw, photos[i % photos.length], { x: area.x + c * (cw + gap), y: area.y + r * (ch + gap), w: cw, h: ch }, 'cover')
    }
  }
  if (footerH) {
    const fy = panel.y + panel.h - margin - footerH
    const foot: Rect = { x: panel.x + margin, y: fy, w: panel.w - margin * 2, h: footerH }
    let left = foot.x, right = foot.x + foot.w
    if (wantQr) {
      const qn = opts.qr!.length + 4
      const sizeTarget = Math.min(foot.h, Math.floor(foot.w * 0.4))
      const mod = Math.max(1, Math.floor(sizeTarget / qn))
      const size = mod * qn
      drawQr(dest, dw, opts.qr!, { x: right - size, y: foot.y, w: size, h: foot.h })
      right -= size + gap
    }
    if (wantLogo) {
      const lh = Math.round(foot.h * 0.8)
      const lw = Math.min(Math.round(foot.w * 0.35), Math.round(lh * (opts.logo!.width / opts.logo!.height)))
      blit(dest, dw, opts.logo!, { x: left, y: foot.y + Math.round((foot.h - lh) / 2), w: lw, h: lh }, 'contain')
      left += lw + gap
    }
    const text = opts.footerText ?? layout.footerText
    if (wantText && text) {
      const avail = right - left
      const bmp = avail > 8 ? renderText(text, avail, Math.round(foot.h * 0.6)) : null
      if (bmp) {
        const tx = left + Math.max(0, Math.round((avail - bmp.width) / 2))
        blit(dest, dw, bmp, { x: tx, y: foot.y + Math.round((foot.h - bmp.height) / 2), w: bmp.width, h: bmp.height }, 'contain')
      }
    }
  }
}

/**
 * Lay composites out on a print sheet of exactly PRINT_PX[layout.size] pixels, white background.
 * For '2x6-strip' the sheet holds two identical 600x1800 strips side by side.
 */
export function layoutSheet(layout: PrintLayout, composites: RGBAImage[], opts: LayoutOpts = {}): RGBAImage {
  const { w, h } = PRINT_PX[layout.size]
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  if (layout.size === '2x6-strip') {
    const half = w / 2
    for (let s = 0; s < 2; s++) renderPanel(data, w, { x: s * half, y: 0, w: half, h }, layout, composites, opts, true)
  } else {
    renderPanel(data, w, { x: 0, y: 0, w, h }, layout, composites, opts, false)
  }
  return { data, width: w, height: h }
}
