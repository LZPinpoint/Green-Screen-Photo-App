// In-memory BoothAPI for developing/screenshotting the admin UI without Electron. Only imported by harness.tsx.
import { DEFAULT_SETTINGS } from '../../../shared/types'
import type { BoothAPI, BackgroundScene, FrameOverlay, PrintLayout, Session, VenueSettings } from '../../../shared/types'
import { drawSilhouette, makeCanvas, sampleCanvas } from '../imgutil'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function art(w: number, h: number, a: string, b: string, kind: number): string {
  const c = makeCanvas(w, h), g = c.getContext('2d')!
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h)
  g.fillStyle = 'rgba(255,255,255,.18)'
  for (let i = 0; i < 6; i++) { g.beginPath(); if (kind === 0) g.arc(w * (0.15 + i * 0.16), h * 0.25 + (i % 2) * 30, 14 + i * 4, 0, 7); else g.moveTo(i * w / 5, h), g.lineTo(i * w / 5 + w / 8, h * (0.4 + (i % 3) * 0.1)), g.lineTo(i * w / 5 + w / 4, h); g.fill() }
  return c.toDataURL('image/jpeg', 0.85)
}
function frameArt(): string {
  const c = makeCanvas(400, 600), g = c.getContext('2d')!
  g.strokeStyle = '#B80021'; g.lineWidth = 26; g.strokeRect(13, 13, 374, 574); g.fillStyle = '#fff'; g.font = '700 26px sans-serif'; g.fillText('imagine', 130, 570)
  return c.toDataURL('image/png')
}

export function installMock() {
  const scenes: BackgroundScene[] = [
    { id: 'dino', name: 'dinosaur hall', category: 'dinosaurs', file: 'backgrounds/dino.jpg', anchor: { x: 0.5, y: 0.96, scale: 0.78 }, enabled: true },
    { id: 'space', name: 'deep space', category: 'space', file: 'backgrounds/space.jpg', anchor: { x: 0.4, y: 0.95, scale: 0.7 }, enabled: true },
    { id: 'egypt', name: 'ancient egypt', category: 'ancient egypt', file: 'backgrounds/egypt.jpg', anchor: { x: 0.6, y: 0.97, scale: 0.82 }, enabled: true },
    { id: 'gallery', name: 'art gallery', category: 'art', file: 'backgrounds/gallery.jpg', anchor: { x: 0.5, y: 0.97, scale: 0.8 }, enabled: false },
    { id: 'ocean', name: 'ocean floor', category: 'nature', file: 'backgrounds/ocean.jpg', anchor: { x: 0.5, y: 0.97, scale: 0.8 }, enabled: true }
  ]
  const pal: Record<string, [string, string, number]> = { dino: ['#2e7d32', '#a5d6a7', 1], space: ['#0b0b2b', '#6a1b9a', 0], egypt: ['#c9a227', '#7b3f00', 1], gallery: ['#444', '#bbb', 1], ocean: ['#006994', '#00bcd4', 0] }
  const files = new Map<string, string>()
  scenes.forEach(s => { const p = pal[s.id]; files.set(s.file, art(600, 900, p[0], p[1], p[2])) })
  const frames: FrameOverlay[] = [{ id: 'f1', name: 'imagine border', file: 'frames/f1.png', enabled: true }, { id: 'f2', name: 'museum plaque', file: 'frames/f2.png', enabled: false }]
  frames.forEach(f => files.set(f.file, frameArt()))
  const layouts: PrintLayout[] = [
    { id: 'classic-4x6', name: 'classic 4x6', size: '4x6', photosPerSheet: 1, showLogo: true, footerText: 'your venue · 2026', qrCode: false },
    { id: 'strip', name: 'photo strip', size: '2x6-strip', photosPerSheet: 3, showLogo: true, qrCode: true },
    { id: 'quad', name: 'four-up', size: '4x6', photosPerSheet: 4, showLogo: false, footerText: 'step into the story', qrCode: true }
  ]
  let settings: VenueSettings = structuredClone(DEFAULT_SETTINGS); settings.venueName = 'franklin institute'; settings.printerName = 'DNP DS620'; settings.cameraId = 'sim'
  const byDay: Record<string, number> = {}
  const now = new Date()
  for (let i = 0; i < 12; i++) byDay[dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))] = Math.round(12 + 30 * Math.abs(Math.sin(i * 1.7)) + (i === 0 ? 8 : 0))
  const sessions: Session[] = Array.from({ length: 8 }, (_, i) => {
    const sc = scenes[i % 4]
    const key = `sessions/s${i}.jpg`
    const c = makeCanvas(300, 225), g = c.getContext('2d')!; const bgi = new Image(); void bgi
    g.fillStyle = pal[sc.id][0]; g.fillRect(0, 0, 300, 225); drawSilhouette(g, 150, 220, 180, '#e8c1a0')
    files.set(key, c.toDataURL('image/jpeg', 0.8))
    return { id: 's' + i, createdAt: Date.now() - i * 17 * 60000, shots: [{ raw: key }], sceneId: sc.id, composite: key, printed: 1 + (i % 2) }
  })
  const byScene: Record<string, number> = { dino: 142, space: 97, egypt: 88, ocean: 41, gallery: 6 }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

  const api: BoothAPI = {
    camera: {
      list: async () => [{ id: 'sim', label: 'simulated camera', kind: 'simulated' }, { id: 'usb:canon', label: 'canon eos r50', kind: 'dslr' }, { id: 'cam0', label: 'facetime hd camera', kind: 'webcam' }],
      connect: async () => { await wait(400) },
      capture: async () => { await wait(850); return sampleCanvas(1280, 720).toDataURL('image/jpeg', 0.9) }
    },
    printer: {
      list: async () => [{ name: 'DNP DS620', displayName: 'DNP DS620', isDefault: true, status: 'ready' }, { name: 'virtual-pdf', displayName: 'virtual pdf printer', isDefault: false, status: 'ready' }, { name: 'Office', displayName: 'office laser', isDefault: false, status: 'offline' }],
      print: async (id, n) => { await wait(300); const s = sessions.find(x => x.id === id); if (s) s.printed += n; return { jobId: 'job-' + Date.now().toString(36) } }
    },
    session: {
      start: async () => { const s: Session = { id: 'mock-' + Date.now(), createdAt: Date.now(), shots: [], printed: 0 }; sessions.unshift(s); return s },
      saveShot: async (id) => sessions.find(s => s.id === id)!,
      saveComposite: async (id, url) => { const s = sessions.find(x => x.id === id)!; s.composite = `sessions/${id}.jpg`; files.set(s.composite, url); return s },
      get: async id => sessions.find(s => s.id === id),
      list: async n => sessions.slice(0, n ?? 20),
      update: async (id: string, p: Partial<Session>) => { const s = sessions.find(x => x.id === id); if (s) Object.assign(s, p); return s }
    } as BoothAPI['session'],
    library: {
      scenes: async () => structuredClone(scenes),
      saveScene: async (s, img) => { const i = scenes.findIndex(x => x.id === s.id); if (i >= 0) scenes[i] = structuredClone(s); else scenes.push(structuredClone(s)); if (img) files.set(s.file, img) },
      deleteScene: async id => { const i = scenes.findIndex(x => x.id === id); if (i >= 0) scenes.splice(i, 1) },
      frames: async () => structuredClone(frames),
      layouts: async () => structuredClone(layouts),
      saveFrame: async f => { const i = frames.findIndex(x => x.id === f.id); if (i >= 0) frames[i] = structuredClone(f); else frames.push(structuredClone(f)) },
      saveLayout: async l => { const i = layouts.findIndex(x => x.id === l.id); if (i >= 0) layouts[i] = structuredClone(l); else layouts.push(structuredClone(l)) },
      imageUrl: async f => files.get(f) ?? ''
    },
    settings: { get: async () => structuredClone(settings), set: async p => { settings = { ...settings, ...p }; return structuredClone(settings) } },
    stats: { summary: async () => ({ sessions: sum(byDay), prints: Math.round(sum(byDay) * 1.4), byScene, byDay }) },
    ai: { cutout: async d => { await wait(600); return d } },
    share: {
      enabled: async () => !!settings.share?.enabled,
      reserve: async id => settings.share?.enabled ? { shareId: 'sh-' + id, guestUrl: `${settings.share.baseUrl}/p/${id}` } : null,
      email: async () => ({ queued: true }),
      status: async () => ({ pending: 2, failed: 1, total: 134 })
    }
  }
  ;(window as any).booth = api
}
