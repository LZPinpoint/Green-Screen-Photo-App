import type { RGBAImage } from './keying/chromaKey'

const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function'

/** Load a URL / data URL into an HTMLImageElement (browser only). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('loadImage: browser only')); return }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('loadImage: failed to load image'))
    img.src = src
  })
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (!hasDom()) throw new Error('canvas helpers are browser only')
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

/** Decode a data URL into RGBA pixels, optionally downscaling so the long side is <= maxSide. */
export async function dataUrlToImageData(dataUrl: string, maxSide?: number): Promise<RGBAImage> {
  const img = await loadImage(dataUrl)
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  if (maxSide && Math.max(w, h) > maxSide) {
    const s = maxSide / Math.max(w, h)
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s))
  }
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  return { data: new Uint8ClampedArray(d.data), width: w, height: h }
}

/** Encode RGBA pixels as a data URL (png keeps alpha; jpeg flattens). */
export function imageDataToDataUrl(img: RGBAImage, type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): string {
  const c = makeCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const copy = new Uint8ClampedArray(img.data)
  ctx.putImageData(new ImageData(copy, img.width, img.height), 0, 0)
  return c.toDataURL(type, quality)
}
