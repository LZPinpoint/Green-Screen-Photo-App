import type { RGBAImage } from '../../src/core'

export const GREEN: [number, number, number] = [0, 177, 64]
export const SKIN: [number, number, number] = [224, 172, 140]
export const CLOTHES: [number, number, number] = [90, 130, 90] // near-green
export const SPILL: [number, number, number] = [160, 200, 120]

/** green rect background, skin circle (soft edge), near-green clothing block, spill patch. */
export function synth(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4)
  const cx = w * 0.5, cy = h * 0.35, rad = h * 0.18
  const body = { x0: w * 0.38, x1: w * 0.62, y0: h * 0.55, y1: h * 0.95 }
  const spill = { x0: w * 0.1, x1: w * 0.2, y0: h * 0.4, y1: h * 0.5 }
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4
      const n = (rnd() - 0.5) * 6
      let c: number[] = [GREEN[0] + n, GREEN[1] + n, GREEN[2] + n]
      const d = Math.hypot(x - cx, y - cy)
      if (d < rad + 2) {
        const t = d <= rad - 2 ? 1 : (rad + 2 - d) / 4
        c = [0, 1, 2].map((k) => GREEN[k] + (SKIN[k] - GREEN[k]) * t)
      }
      if (x > body.x0 && x < body.x1 && y > body.y0 && y < body.y1) c = [...CLOTHES]
      if (x > spill.x0 && x < spill.x1 && y > spill.y0 && y < spill.y1) c = [...SPILL]
      data[j] = c[0]; data[j + 1] = c[1]; data[j + 2] = c[2]; data[j + 3] = 255
    }
  }
  return { img: { data, width: w, height: h } as RGBAImage, cx, cy, rad, body, spill }
}

export function solid(w: number, h: number, rgba: [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4)
  return { data, width: w, height: h }
}
export const px = (img: RGBAImage, x: number, y: number) => {
  const j = (Math.round(y) * img.width + Math.round(x)) * 4
  return [img.data[j], img.data[j + 1], img.data[j + 2], img.data[j + 3]]
}
