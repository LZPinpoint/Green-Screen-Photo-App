// Canvas-drawn animated "person in front of a green screen". Used when no webcam is available
// (plain-browser demo without camera permission, or dev machines without a camera).

const SKIN = '#e0ac8a'

export function drawSyntheticFrame(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  // green screen with gentle uneven lighting
  ctx.fillStyle = 'rgb(0,177,64)'; ctx.fillRect(0, 0, w, h)
  const g = ctx.createRadialGradient(w * 0.5, h * 0.35, h * 0.1, w * 0.5, h * 0.5, h * 0.95)
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)

  const s = h / 720
  const cx = w / 2 + Math.sin(t * 0.8) * 22 * s
  const bob = Math.sin(t * 2) * 5 * s
  ctx.save(); ctx.translate(cx, bob)
  // torso
  ctx.fillStyle = '#B80021'
  ctx.beginPath(); ctx.roundRect(-120 * s, 330 * s, 240 * s, 400 * s, 70 * s); ctx.fill()
  // neck
  ctx.fillStyle = SKIN; ctx.fillRect(-26 * s, 280 * s, 52 * s, 70 * s)
  // arms (right arm waves)
  ctx.lineCap = 'round'; ctx.lineWidth = 48 * s; ctx.strokeStyle = '#B80021'
  ctx.beginPath(); ctx.moveTo(-105 * s, 380 * s); ctx.lineTo(-150 * s, 560 * s); ctx.stroke()
  const wave = Math.sin(t * 5) * 0.35
  const ex = 105 * s + Math.sin(wave) * 20 * s, hx = ex + Math.sin(wave + 0.6) * 90 * s
  ctx.beginPath(); ctx.moveTo(105 * s, 380 * s); ctx.lineTo(ex + 60 * s, 290 * s); ctx.lineTo(hx + 70 * s, 190 * s); ctx.stroke()
  ctx.fillStyle = SKIN
  ctx.beginPath(); ctx.arc(hx + 70 * s, 175 * s, 30 * s, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(-150 * s, 575 * s, 28 * s, 0, Math.PI * 2); ctx.fill()
  // head + hair
  ctx.fillStyle = SKIN; ctx.beginPath(); ctx.ellipse(0, 210 * s, 78 * s, 92 * s, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#2b1b14'
  ctx.beginPath(); ctx.ellipse(0, 150 * s, 86 * s, 62 * s, 0, Math.PI, 0); ctx.fill()
  // face
  ctx.fillStyle = '#181818'
  ctx.beginPath(); ctx.arc(-28 * s, 206 * s, 7 * s, 0, 7); ctx.arc(28 * s, 206 * s, 7 * s, 0, 7); ctx.fill()
  ctx.strokeStyle = '#8f3b2c'; ctx.lineWidth = 5 * s
  ctx.beginPath(); ctx.arc(0, 235 * s, 28 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
  ctx.restore()
}

export interface SyntheticCamera { stream: MediaStream; stop(): void }

export function createSyntheticCamera(w = 1280, h = 720): SyntheticCamera {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  let raf = 0, alive = true
  const t0 = performance.now()
  const tick = () => {
    if (!alive) return
    drawSyntheticFrame(ctx, w, h, (performance.now() - t0) / 1000)
    raf = requestAnimationFrame(tick)
  }
  tick()
  const stream = c.captureStream(30)
  return { stream, stop() { alive = false; cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()) } }
}

export function syntheticStillDataUrl(w = 1280, h = 720): string {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  drawSyntheticFrame(c.getContext('2d')!, w, h, Math.random() * 10)
  return c.toDataURL('image/jpeg', 0.92)
}
