// In-memory BoothAPI for plain-browser use (dev + the public web demo). No Electron, no backend.
// Webcam is handled by the kiosk (getUserMedia, falling back to a canvas-drawn green-screen person);
// camera.capture() here returns a synthetic still for DSLR-style flows.
import type { BoothAPI, BackgroundScene, FrameOverlay, PrintLayout, Session, VenueSettings, ImageData64 } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { syntheticStillDataUrl } from './kiosk/syntheticCamera'

const LS_KEY = 'imagine-booth-demo-settings'
export const DEMO_PHOTO_PREFIX = 'imagine-booth-demo-photo:'
const DEMO_PHOTO_INDEX = 'imagine-booth-demo-photos'
const MAX_DEMO_PHOTOS = 4

/** shrink + store the final composite so the demo gallery page can show it (localStorage is small: keep a few, ~700px) */
async function storeDemoPhoto(shareId: string, dataUrl: ImageData64): Promise<void> {
  try {
    let small: string
    try { // off the main thread (the staff image worker): staff mode saves a sheet every few seconds
      const { getEngine } = await import('./staff/engineClient')
      small = await (await getEngine()).call<string>('thumb', { url: dataUrl, max: 800 })
    } catch {
      const img = new Image(); img.src = dataUrl; await img.decode()
      const k = Math.min(1, 800 / img.naturalWidth)
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      small = c.toDataURL('image/jpeg', 0.82)
    }
    let idx: string[] = []
    try { idx = JSON.parse(localStorage.getItem(DEMO_PHOTO_INDEX) || '[]') } catch { idx = [] }
    idx = [...idx.filter(i => i !== shareId), shareId]
    while (idx.length > MAX_DEMO_PHOTOS) { const old = idx.shift()!; localStorage.removeItem(DEMO_PHOTO_PREFIX + old) }
    localStorage.setItem(DEMO_PHOTO_PREFIX + shareId, small)
    localStorage.setItem(DEMO_PHOTO_INDEX, JSON.stringify(idx))
  } catch { /* storage blocked/full or image failed: the gallery just shows its not-found state */ }
}
const W = 800, H = 1200

// ─── generated scenes ───
type Painter = (c: CanvasRenderingContext2D) => void
const grad = (c: CanvasRenderingContext2D, stops: [number, string][], x0 = 0, y0 = 0, x1 = 0, y1 = H) => {
  const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); c.fillStyle = g; c.fillRect(0, 0, W, H)
}
const rnd = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const blob = (c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) => {
  const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'transparent'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2)
}
function ridge(c: CanvasRenderingContext2D, base: number, amp: number, col: string, seed: number) {
  const r = rnd(seed); c.fillStyle = col; c.beginPath(); c.moveTo(0, H)
  for (let x = 0; x <= W; x += 40) c.lineTo(x, base - r() * amp)
  c.lineTo(W, H); c.fill()
}
function fern(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  c.strokeStyle = col; c.lineWidth = 4 * s; c.lineCap = 'round'
  for (let a = -1.2; a <= 1.2; a += 0.3) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.sin(a) * 60 * s, y - 80 * s, x + Math.sin(a) * 130 * s, y - 60 * s * Math.cos(a) - 40 * s); c.stroke() }
}
function dino(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  c.fillStyle = col; c.beginPath(); c.ellipse(x, y, 90 * s, 50 * s, 0, 0, 7); c.fill()
  c.lineCap = 'round'; c.strokeStyle = col; c.lineWidth = 30 * s
  c.beginPath(); c.moveTo(x + 60 * s, y - 20 * s); c.quadraticCurveTo(x + 130 * s, y - 40 * s, x + 120 * s, y - 150 * s); c.stroke()
  c.beginPath(); c.arc(x + 128 * s, y - 158 * s, 20 * s, 0, 7); c.fill()
  c.lineWidth = 22 * s; c.beginPath(); c.moveTo(x - 80 * s, y); c.quadraticCurveTo(x - 170 * s, y + 20 * s, x - 200 * s, y - 20 * s); c.stroke()
  c.lineWidth = 20 * s; for (const dx of [-40, 40]) { c.beginPath(); c.moveTo(x + dx * s, y + 30 * s); c.lineTo(x + dx * s, y + 100 * s); c.stroke() }
}
const stars = (c: CanvasRenderingContext2D, n: number, seed: number) => {
  const r = rnd(seed); for (let i = 0; i < n; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; c.beginPath(); c.arc(r() * W, r() * H, r() * 2 + 0.4, 0, 7); c.fill() }
}
const SCENES: { s: Omit<BackgroundScene, 'file' | 'enabled' | 'anchor'>; paint: Painter }[] = [
  { s: { id: 'dino-dusk', name: 'volcano dusk', category: 'dinosaurs' }, paint: c => {
    grad(c, [[0, '#2a0b2e'], [0.45, '#c2410c'], [0.7, '#f59e0b'], [1, '#3b1d0b']])
    blob(c, 560, 560, 260, 'rgba(255,200,80,.8)')
    c.fillStyle = '#26130c'; c.beginPath(); c.moveTo(250, 800); c.lineTo(520, 380); c.lineTo(600, 380); c.lineTo(860, 800); c.fill()
    blob(c, 560, 380, 120, 'rgba(255,90,20,.9)'); ridge(c, 900, 140, '#1c0f09', 3)
    dino(c, 190, 900, 0.8, '#120907'); dino(c, 640, 860, 0.5, '#1a0d08'); fern(c, 60, 1160, 1.4, '#0e1a0a'); fern(c, 760, 1170, 1.2, '#0e1a0a') } },
  { s: { id: 'dino-jungle', name: 'jurassic jungle', category: 'dinosaurs' }, paint: c => {
    grad(c, [[0, '#a7e3c4'], [0.5, '#2f9e6a'], [1, '#0c3b24']]); blob(c, 200, 160, 300, 'rgba(255,255,220,.8)')
    ridge(c, 700, 200, '#1e7a4d', 5); ridge(c, 880, 150, '#14573a', 8)
    dino(c, 540, 840, 0.9, '#0b3322'); for (let i = 0; i < 6; i++) fern(c, 60 + i * 150, 1150 + (i % 2) * 20, 1.5, '#082a1a') } },
  { s: { id: 'space-planet', name: 'ringed planet', category: 'space' }, paint: c => {
    grad(c, [[0, '#05060f'], [1, '#1b1040']]); stars(c, 220, 11); blob(c, 600, 300, 420, 'rgba(120,80,255,.35)')
    const g = c.createRadialGradient(540, 360, 20, 560, 380, 190); g.addColorStop(0, '#ffd3a1'); g.addColorStop(1, '#a8452c')
    c.fillStyle = g; c.beginPath(); c.arc(560, 380, 180, 0, 7); c.fill()
    c.strokeStyle = 'rgba(255,230,200,.7)'; c.lineWidth = 14; c.beginPath(); c.ellipse(560, 380, 330, 70, -0.4, 0, 7); c.stroke()
    c.fillStyle = '#12142a'; c.beginPath(); c.arc(180, 1150, 340, 0, 7); c.fill() } },
  { s: { id: 'space-nebula', name: 'nebula nursery', category: 'space' }, paint: c => {
    grad(c, [[0, '#050514'], [1, '#14052a']]); blob(c, 250, 350, 420, 'rgba(255,60,120,.55)'); blob(c, 600, 650, 460, 'rgba(60,120,255,.5)')
    blob(c, 350, 1000, 400, 'rgba(160,60,255,.45)'); stars(c, 320, 21) } },
  { s: { id: 'egypt-pyramids', name: 'giza at golden hour', category: 'ancient egypt' }, paint: c => {
    grad(c, [[0, '#fbd38d'], [0.55, '#f6ad55'], [1, '#c05621']]); blob(c, 400, 560, 280, 'rgba(255,250,200,.95)')
    c.fillStyle = '#b7611f'; c.beginPath(); c.moveTo(80, 860); c.lineTo(330, 520); c.lineTo(580, 860); c.fill()
    c.fillStyle = '#9a4e18'; c.beginPath(); c.moveTo(430, 860); c.lineTo(620, 640); c.lineTo(800, 860); c.fill()
    ridge(c, 960, 80, '#d9904a', 2); ridge(c, 1100, 70, '#a8591a', 6) } },
  { s: { id: 'sea-reef', name: 'deep blue reef', category: 'under the sea' }, paint: c => {
    grad(c, [[0, '#7fe0ff'], [0.4, '#0e7fb8'], [1, '#04203d']])
    c.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(100 + i * 160, 0); c.lineTo(200 + i * 160, 0); c.lineTo(60 + i * 160, 1000); c.lineTo(i * 160 - 40, 1000); c.fill() }
    const r = rnd(9); for (let i = 0; i < 40; i++) { c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2; c.beginPath(); c.arc(r() * W, r() * H, r() * 14 + 3, 0, 7); c.stroke() }
    ridge(c, 1000, 160, '#ff6b6b', 4); ridge(c, 1100, 120, '#8b2a63', 7) } },
]

let sceneCache: Record<string, string> | null = null
function sceneImages(): Record<string, string> {
  if (sceneCache) return sceneCache
  sceneCache = {}
  for (const { s, paint } of SCENES) {
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!; paint(ctx)
    sceneCache['mock:' + s.id] = c.toDataURL('image/jpeg', 0.85)
  }
  const frame = (id: string, col: string, label: string) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')!
    x.strokeStyle = col; x.lineWidth = 36; x.beginPath(); x.roundRect(18, 18, W - 36, H - 36, 70); x.stroke()
    x.fillStyle = col; x.beginPath(); x.roundRect(W / 2 - 150, H - 120, 300, 70, 35); x.fill()
    x.fillStyle = '#fff'; x.font = '700 34px Helvetica, Arial, sans-serif'; x.textAlign = 'center'; x.fillText(label, W / 2, H - 73)
    sceneCache!['mock:frame-' + id] = c.toDataURL('image/png')
  }
  frame('red', '#B80021', 'imagine'); frame('white', '#ffffff', 'step into the story')
  return sceneCache
}

const SCENE_LIST = (): BackgroundScene[] => SCENES.map(({ s }) => ({
  ...s, file: 'mock:' + s.id, enabled: true, anchor: { x: 0.5, y: 1, scale: 0.78 }
}))
const FRAMES: FrameOverlay[] = [
  { id: 'red', name: 'imagine red', file: 'mock:frame-red', enabled: true },
  { id: 'white', name: 'clean white', file: 'mock:frame-white', enabled: true }
]
const LAYOUTS: PrintLayout[] = [
  { id: 'classic-4x6', name: 'classic 4x6', size: '4x6', photosPerSheet: 1, showLogo: true, footerText: 'your venue', qrCode: false },
  { id: 'strip-2x6', name: 'photo strip', size: '2x6-strip', photosPerSheet: 3, showLogo: true, footerText: 'your venue', qrCode: false },
  { id: 'grid-4up', name: 'four-up', size: '4x6', photosPerSheet: 4, showLogo: true, footerText: 'your venue', qrCode: false }
]

// ─── virtual print: pops the finished sheet out of a pretend printer ───
function showVirtualPrint(dataUrl: string, label: string) {
  document.getElementById('virtual-print')?.remove()
  const el = document.createElement('div'); el.id = 'virtual-print'
  el.innerHTML = `<div class="vp-slot"></div><div class="vp-paper"><img alt="printed sheet"/><small></small></div>`
  ;(el.querySelector('img') as HTMLImageElement).src = dataUrl
  el.querySelector('small')!.textContent = label
  el.addEventListener('pointerdown', e => { e.stopPropagation(); el.remove() })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}

// ─── the API ───
export function createMockBooth(): BoothAPI {
  const sessions = new Map<string, Session>()
  const composites = new Map<string, ImageData64>()
  // everything saved through the API stays resolvable by library.imageUrl('mem:...') so staff mode can reload today's items
  const files = new Map<string, ImageData64>()
  let fileSeq = 0
  const shareIds = new Map<string, string>()
  const frames: FrameOverlay[] = FRAMES.map(f => ({ ...f }))
  const layouts: PrintLayout[] = LAYOUTS.map(l => ({ ...l }))
  const newShareId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
  const stats = { sessions: 0, prints: 0, byScene: {} as Record<string, number>, byDay: {} as Record<string, number> }
  let settings: VenueSettings = { ...DEFAULT_SETTINGS, venueName: 'the imagine museum', idleTimeoutSec: 45 }
  const withStaff = (st?: Partial<VenueSettings['staff']>) => ({ ...DEFAULT_SETTINGS.staff!, ...(st ?? {}) })
  try { const raw = localStorage.getItem(LS_KEY); if (raw) settings = { ...settings, ...JSON.parse(raw) } } catch { /* storage blocked */ }
  settings = { ...settings, mode: settings.mode ?? 'staff', staff: withStaff(settings.staff) }
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)) } catch { /* ignore */ } }
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  const today = () => new Date().toISOString().slice(0, 10)

  return {
    camera: {
      list: async () => [{ id: 'demo-webcam', label: 'demo camera', kind: 'webcam' as const }],
      connect: async () => {},
      capture: async () => syntheticStillDataUrl()
    },
    printer: {
      list: async () => [{ name: 'virtual', displayName: 'virtual printer (demo)', isDefault: true, status: 'ready' as const }],
      async print(sessionId, copies) {
        await wait(1800)
        const s = sessions.get(sessionId); const img = composites.get(sessionId)
        if (!s || !img) throw new Error('nothing to print yet')
        s.printed += copies; stats.prints += copies
        showVirtualPrint(img, `virtual print · ${copies} ${copies === 1 ? 'copy' : 'copies'}`)
        return { jobId: 'demo-' + Date.now() }
      }
    },
    session: {
      async start() {
        const s: Session = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: Date.now(), shots: [], printed: 0 }
        sessions.set(s.id, s); stats.sessions++; stats.byDay[today()] = (stats.byDay[today()] ?? 0) + 1
        return s
      },
      async saveShot(id, dataUrl) { const s = sessions.get(id)!; const path = `mem:shot:${id}:${s.shots.length}`; files.set(path, dataUrl); s.shots.push({ raw: path }); return s },
      // extra (same shape as the Electron main's session:update): scene/frame/ticket/label/test, merged into the session
      async update(id: string, patch: Partial<Session>) {
        const s = sessions.get(id); if (!s) throw new Error('no such session')
        for (const k of ['sceneId', 'frameId', 'emailed', 'test', 'ticket', 'label'] as const) if (patch[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = patch[k]
        return s
      },
      async saveComposite(id, dataUrl) {
        const s = sessions.get(id)!; composites.set(id, dataUrl); s.composite = `mem:comp:${id}:${++fileSeq}`; files.set(s.composite, dataUrl)
        const shareId = shareIds.get(id)
        if (shareId) setTimeout(() => void storeDemoPhoto(shareId, dataUrl), 1500) // background, deferred so it never lands on a capture
        return s
      },
      get: async id => sessions.get(id),
      list: async (limit = 50) => [...sessions.values()].slice(-limit).reverse()
    } as BoothAPI['session'],
    library: {
      scenes: async () => SCENE_LIST(),
      saveScene: async () => {},
      deleteScene: async () => {},
      frames: async () => frames.map(f => ({ ...f })),
      saveFrame: async f => { const i = frames.findIndex(x => x.id === f.id); if (i >= 0) frames[i] = { ...f }; else frames.push({ ...f }) },
      layouts: async () => layouts.map(l => ({ ...l, footerText: settings.venueName })),
      saveLayout: async l => { const i = layouts.findIndex(x => x.id === l.id); if (i >= 0) layouts[i] = { ...l }; else layouts.push({ ...l }) },
      imageUrl: async file => files.get(file) ?? sceneImages()[file] ?? ''
    },
    settings: {
      get: async () => settings,
      set: async patch => {
        settings = { ...settings, ...patch, ...(patch.staff ? { staff: withStaff({ ...settings.staff, ...patch.staff }) } : {}) }
        persist(); return settings
      }
    },
    stats: { summary: async () => ({ ...stats }) },
    // web demo: a real in-browser person cutout (onnxruntime-web + u2netp, lazy, self-hosted). Electron builds drop this branch entirely.
    ai: {
      cutout: async d => {
        if (typeof __WEB_DEMO__ === 'undefined' || !__WEB_DEMO__) throw new Error('ai cutout is not available in this build')
        return (await import('@webai/webCutout')).webCutout(d)
      },
      warm: () => { if (typeof __WEB_DEMO__ !== 'undefined' && __WEB_DEMO__) void import('@webai/webCutout').then(m => m.webWarm()).catch(() => {}) }
    } as BoothAPI['ai'],
    share: {
      enabled: async () => true,
      async reserve(sessionId) {
        let shareId = shareIds.get(sessionId)
        if (!shareId) { shareId = newShareId(); shareIds.set(sessionId, shareId) }
        return { shareId, guestUrl: `${location.origin}${location.pathname}#/g/${shareId}` }
      },
      // demo: nothing is stored or sent anywhere
      async email(_shareId, _email, consent) { await wait(900); if (!consent) throw new Error('consent required'); return { queued: true } },
      status: async () => ({ pending: 0, failed: 0, total: 0 })
    }
  }
}

/** Install the mock when running outside Electron. Returns true if installed. */
export function installMockBooth(): boolean {
  if (typeof window === 'undefined' || (window as { booth?: BoothAPI }).booth) return false
  window.booth = createMockBooth()
  ;(window as unknown as { __BOOTH_MOCK__?: boolean }).__BOOTH_MOCK__ = true
  return true
}
