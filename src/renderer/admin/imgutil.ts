// Small canvas/image utilities for the admin UI (kept local so admin only depends on window.booth + @core/index).
import type { RGBAImage } from '@core/index'

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed to load')); i.src = src })
}
export function makeCanvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
export function toRGBA(src: CanvasImageSource & { width?: number; height?: number; videoWidth?: number; naturalWidth?: number; naturalHeight?: number; videoHeight?: number }, maxW = 640): RGBAImage {
  const sw = (src as any).videoWidth || (src as any).naturalWidth || (src as any).width, sh = (src as any).videoHeight || (src as any).naturalHeight || (src as any).height
  const w = Math.min(maxW, sw), h = Math.round(sh * w / sw)
  const c = makeCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(src, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h)
  return { data: d.data, width: w, height: h }
}
export function rgbaToCanvas(img: RGBAImage): HTMLCanvasElement {
  const c = makeCanvas(img.width, img.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return c
}
export const rgbaToDataUrl = (img: RGBAImage, type = 'image/jpeg', q = 0.9) => rgbaToCanvas(img).toDataURL(type, q)
export const fileToDataUrl = (f: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f) })
export function download(name: string, text: string | Blob, type = 'application/json') {
  const b = text instanceof Blob ? text : new Blob([text], { type })
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Draw a generic person silhouette with feet at (cx, bottom) and total height h. */
export function drawSilhouette(g: CanvasRenderingContext2D, cx: number, bottom: number, h: number, fill = 'rgba(255,255,255,.85)') {
  g.save(); g.fillStyle = fill
  const headR = h * 0.09, top = bottom - h
  g.beginPath(); g.arc(cx, top + headR, headR, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.roundRect(cx - h * 0.17, top + headR * 2.2, h * 0.34, h * 0.42, h * 0.1); g.fill()
  g.beginPath(); g.roundRect(cx - h * 0.12, top + headR * 2.2 + h * 0.36, h * 0.24, h * 0.5 - headR * 2.2 + 0, h * 0.04); g.fill()
  g.restore()
}
/** Synthetic "scene + subject" test image, used when no real art / camera is available. */
export function sampleCanvas(w: number, h: number, withSubject = true): HTMLCanvasElement {
  const c = makeCanvas(w, h), g = c.getContext('2d')!
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#00b140'); gr.addColorStop(1, '#00973a')
  g.fillStyle = gr; g.fillRect(0, 0, w, h)
  if (withSubject) drawSilhouette(g, w / 2, h * 0.96, h * 0.8, '#d9a07a')
  return c
}
/** Subject anchor convention used by the admin previews: subject feet at (x*W, y*H), subject height = scale*H. */
export function drawAnchored(g: CanvasRenderingContext2D, W: number, H: number, a: { x: number; y: number; scale: number }, subject?: CanvasImageSource & { width: number; height: number }) {
  const h = a.scale * H
  if (subject) { const w = h * subject.width / subject.height; g.drawImage(subject, a.x * W - w / 2, a.y * H - h, w, h) }
  else drawSilhouette(g, a.x * W, a.y * H, h)
}
export function drawCover(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, W: number, H: number) {
  const iw = (img as any).naturalWidth || img.width, ih = (img as any).naturalHeight || img.height
  const s = Math.max(W / iw, H / ih); g.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s)
}

/** Color + alignment test sheet at exact print size. */
export function testSheet(w: number, h: number, label: string): HTMLCanvasElement {
  const c = makeCanvas(w, h), g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h)
  const u = Math.min(w, h) / 20
  const cols = ['#000', '#fff', '#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00', '#B80021', '#00b140']
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(u + i * ((w - 2 * u) / cols.length), u * 2, (w - 2 * u) / cols.length, u * 3); g.strokeStyle = '#999'; g.strokeRect(u + i * ((w - 2 * u) / cols.length), u * 2, (w - 2 * u) / cols.length, u * 3) })
  const gy = g.createLinearGradient(u, 0, w - u, 0); gy.addColorStop(0, '#000'); gy.addColorStop(1, '#fff')
  g.fillStyle = gy; g.fillRect(u, u * 6, w - 2 * u, u * 2)
  const skin = ['#f3d5c0', '#e0ac8b', '#c68642', '#8d5524', '#5a3825']
  skin.forEach((col, i) => { g.fillStyle = col; g.fillRect(u + i * ((w - 2 * u) / 5), u * 8.5, (w - 2 * u) / 5, u * 2) })
  // alignment: border, crosshairs, corner ticks, diagonals
  g.strokeStyle = '#000'; g.lineWidth = Math.max(2, u / 10)
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth)
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke()
  g.beginPath(); g.arc(w / 2, h / 2, u * 2, 0, Math.PI * 2); g.stroke()
  g.fillStyle = '#000'; g.font = `700 ${u * 0.9}px sans-serif`; g.textAlign = 'center'
  g.fillText(`imagine booth test sheet  ${w}x${h}px`, w / 2, h - u * 2.2)
  g.fillText(label, w / 2, h - u * 1.1)
  return c
}

/** 'imagine.' text logo with transparent background (dark type, red dot) for print sheets. */
export function logoRGBA(h = 120): RGBAImage {
  const c = makeCanvas(h * 4, h), g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#181818'; g.font = `800 ${h * 0.75}px 'Axiforma','Poppins','Helvetica Neue',Arial,sans-serif`; g.textBaseline = 'middle'
  g.fillText('imagine', 4, h / 2)
  const w = g.measureText('imagine').width
  g.fillStyle = '#B80021'; g.beginPath(); g.arc(4 + w + h * 0.09, h / 2 + h * 0.27, h * 0.075, 0, Math.PI * 2); g.fill()
  const out = g.getImageData(0, 0, c.width, c.height)
  return { data: out.data, width: c.width, height: c.height }
}
