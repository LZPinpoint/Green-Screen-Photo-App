// Small browser-side image helpers (mirrors @core/utils: dataUrlToImageData / imageDataToDataUrl / loadImage).
// Kept local so the kiosk never breaks if core/utils moves; swap for '@core/utils' imports at integration if preferred.

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  return c
}

/** Decode a data URL / URL to ImageData, optionally downscaling so the longest side is <= maxDim. */
export async function dataUrlToImageData(url: string, maxDim = 0): Promise<ImageData> {
  const img = await loadImage(url)
  let w = img.naturalWidth, h = img.naturalHeight
  if (maxDim && Math.max(w, h) > maxDim) { const k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k) }
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export function toImageData(p: Pixels): ImageData {
  if (typeof ImageData !== 'undefined' && p instanceof ImageData) return p
  return new ImageData(new Uint8ClampedArray(p.data), p.width, p.height)
}

export function pixelsToCanvas(p: Pixels, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? newCanvas(p.width, p.height)
  if (c.width !== p.width || c.height !== p.height) { c.width = p.width; c.height = p.height }
  c.getContext('2d')!.putImageData(toImageData(p), 0, 0)
  return c
}

export function imageDataToDataUrl(p: Pixels, type: 'image/jpeg' | 'image/png' = 'image/jpeg', q = 0.92): string {
  return pixelsToCanvas(p).toDataURL(type, q)
}

/** Grab the current frame of a <video> as a JPEG data URL (full camera resolution). */
export function grabFrame(video: HTMLVideoElement, q = 0.92): string {
  const c = newCanvas(video.videoWidth || 1280, video.videoHeight || 720)
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', q)
}
