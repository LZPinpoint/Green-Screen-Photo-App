import type { RGBAImage } from '../keying/chromaKey'

/** True when some canvas implementation is available (browser / renderer). False in plain node. */
export function textAvailable(): boolean {
  return typeof OffscreenCanvas !== 'undefined' || (typeof document !== 'undefined' && typeof document.createElement === 'function')
}

/**
 * Render single-line text to an RGBA bitmap (colour on transparent), shrinking the font to fit maxW.
 * Returns null where no canvas exists (node), so callers simply skip the text.
 */
export function renderText(text: string, maxW: number, height: number, color = '#222222', weight = 600): RGBAImage | null {
  if (!text || maxW < 4 || height < 4) return null
  try {
    let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
    let w = Math.max(1, Math.floor(maxW)), h = Math.max(1, Math.floor(height))
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(w, h).getContext('2d') as OffscreenCanvasRenderingContext2D | null
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      ctx = c.getContext('2d')
    }
    if (!ctx) return null
    let size = Math.floor(h * 0.7)
    const font = (s: number) => `${weight} ${s}px "Helvetica Neue", Arial, sans-serif`
    ctx.font = font(size)
    const tw = ctx.measureText(text).width
    if (tw > w) { size = Math.max(6, Math.floor(size * (w / tw))); ctx.font = font(size) }
    const used = Math.min(w, Math.ceil(ctx.measureText(text).width) + 2)
    // re-create canvas at the used width so callers can centre accurately
    w = Math.max(1, used)
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d') as OffscreenCanvasRenderingContext2D
    else { const c = document.createElement('canvas'); c.width = w; c.height = h; ctx = c.getContext('2d') }
    if (!ctx) return null
    ctx.font = font(size)
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, w / 2, h / 2)
    const d = ctx.getImageData(0, 0, w, h)
    return { data: new Uint8ClampedArray(d.data), width: w, height: h }
  } catch {
    return null
  }
}
