// Staff capture pipeline + today's queue. Capture returns instantly; everything else runs async:
//   session.start -> (ticket) -> worker: key -> compose -> sheet(+footer ticket, +qr) -> saveComposite -> [auto print]
// The UI subscribes with useSyncExternalStore and only ever sees small thumbnails.
import { qrMatrix } from '@core/index'
import type { BackgroundScene, BoothAPI, FrameOverlay, PrintLayout, Session, VenueSettings, StaffSettings } from '../../shared/types'
import { getEngine, type Engine } from './engineClient'
import { NEEDRAW, type ComposeResult, type IngestResult, type RawResult, type Img } from './engine'
import { formatTicket, isToday, localDay, nextTicketNumber, normalizeStaff, todaysSessions, type Busy } from './staffLogic'

export const KEY_MAX_DIM = 1600

export interface ShotInfo { path?: string; thumb?: string }
export interface Item {
  key: string                 // local id (temp until the session exists, then the session id)
  sessionId?: string
  ticket?: number
  createdAt: number
  label: string
  shots: ShotInfo[]
  best: number
  sceneId: string
  frameId?: string
  copies: number
  printed: number
  busy: Busy
  failed: { stage: 'process' | 'print'; msg: string } | null
  thumb?: string              // composite preview (small jpeg data url)
  compositePath?: string
  sharing?: boolean
  readyMs?: number            // capture -> composite saved
}
export interface Config {
  settings: VenueSettings; staff: StaffSettings
  scenes: BackgroundScene[]; frames: FrameOverlay[]; layout: PrintLayout; shareEnabled: boolean
}
export interface Frame { bitmap?: ImageBitmap; url?: string }
export interface PerfRecord { ticket?: number; frames: number; captureToReadyMs: number; workerMs?: ComposeResult['ms']; workerMode: string }

type BoothX = BoothAPI & { session: BoothAPI['session'] & { update?(id: string, patch: Record<string, unknown>): Promise<unknown> } }
const booth = () => window.booth as BoothX

// ─── tiny localStorage store (never throws) ───
const ls = {
  get<T>(k: string, fb: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fb } catch { return fb } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* blocked or full */ } }
}
const META_KEY = 'imagine-staff-meta', HIDDEN_KEY = 'imagine-staff-hidden', TICKET_KEY = 'imagine-staff-ticket'
interface Meta { ticket?: number; label?: string; sceneId?: string; frameId?: string; copies?: number; t: number }

async function logoPixels(): Promise<Img | undefined> {
  try {
    // @ts-ignore vite asset import (url string)
    const mod = await import('../../../resources/logos/imagine-white.png?url') as { default: string }
    const img = new Image(); img.src = mod.default; await img.decode()
    const k = Math.min(1, 600 / img.naturalWidth)
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const d = ctx.getImageData(0, 0, c.width, c.height)
    for (let i = 0; i < d.data.length; i += 4) { if (d.data[i] > d.data[i + 1] + 60) continue; d.data[i] = 24; d.data[i + 1] = 24; d.data[i + 2] = 24 }
    return { data: d.data, width: d.width, height: d.height }
  } catch { return undefined }
}

export class Pipeline {
  private cfg: Config | null = null
  private items: Item[] = []
  private subs = new Set<() => void>()
  private engine: Promise<Engine> | null = null
  private hidden = new Set<string>(ls.get<string[]>(HIDDEN_KEY, []))
  private meta = ls.get<Record<string, Meta>>(META_KEY, {})
  private counter = 0
  private qr = new Map<string, Promise<{ qr?: boolean[][] } | null>>()
  private running = new Set<string>()
  private queued = new Map<string, { sceneId?: string; frameId?: string | null; best?: number }>()
  private shareTimer = 0
  private seq = 0
  /** announcements for the aria-live region */
  onAnnounce: (msg: string) => void = () => {}

  // ─── store plumbing ───
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f) } }
  getItems = () => this.items
  private emit() { this.subs.forEach(f => f()) }
  private patch(key: string, p: Partial<Item> | ((i: Item) => Partial<Item>)) {
    let changed = false
    this.items = this.items.map(i => i.key === key ? (changed = true, { ...i, ...(typeof p === 'function' ? p(i) : p) }) : i)
    if (changed) this.emit()
  }
  get(key: string) { return this.items.find(i => i.key === key) }

  configure(cfg: Config) { this.cfg = cfg }
  get config() { return this.cfg }
  private eng() { return this.engine ??= logoPixels().then(getEngine) }
  /** the worker/main engine (also used by the live health check) */
  engineReady() { return this.eng() }

  // ─── tickets ───
  private today() { const s = ls.get<{ day: string; n: number }>(TICKET_KEY, { day: '', n: 0 }); return s.day === localDay() ? s.n : 0 }
  private takeTicket(): number {
    const n = nextTicketNumber(Math.max(this.counter, this.today()), this.items.filter(i => isToday(i.createdAt)).map(i => i.ticket))
    this.counter = n; ls.set(TICKET_KEY, { day: localDay(), n })
    return n
  }
  ticketLabel(n?: number) { return n === undefined ? '—' : formatTicket(this.cfg?.staff.ticketPrefix ?? 'A', n) }
  nextTicketLabel() { return this.ticketLabel(nextTicketNumber(Math.max(this.counter, this.today()), this.items.map(i => i.ticket))) }

  private saveMeta(i: Item) {
    this.meta[i.sessionId ?? i.key] = { ticket: i.ticket, label: i.label, sceneId: i.sceneId, frameId: i.frameId, copies: i.copies, t: i.createdAt }
    const keep = Object.entries(this.meta).filter(([, m]) => Date.now() - m.t < 3 * 86400_000)
    this.meta = Object.fromEntries(keep); ls.set(META_KEY, this.meta)
  }
  private sync(i: Item, extra: Record<string, unknown> = {}) {
    this.saveMeta(i)
    if (!i.sessionId) return
    // session.update is an extra IPC (not in BoothAPI): older mains may ignore ticket/label, so local meta is the fallback
    void booth().session.update?.(i.sessionId, { ticket: i.ticket, label: i.label, sceneId: i.sceneId, frameId: i.frameId, ...extra })?.catch?.(() => {})
  }

  // ─── load today's items ───
  async load() {
    if (!this.cfg) return
    const list = await booth().session.list(500).catch(() => [] as Session[])
    const loaded = todaysSessions(list, this.hidden).map(s => this.fromSession(s))
    const pending = this.items.filter(i => !i.sessionId || !loaded.some(l => l.key === i.key))
    this.items = [...pending, ...loaded.filter(l => !pending.some(p => p.key === l.key))].sort((a, b) => b.createdAt - a.createdAt)
    this.counter = Math.max(this.counter, this.today(), ...this.items.map(i => i.ticket ?? 0))
    this.emit()
    void this.loadThumbs()
  }
  private fromSession(s: Session): Item {
    const m = this.meta[s.id]
    const cfg = this.cfg!
    return {
      key: s.id, sessionId: s.id, createdAt: s.createdAt,
      ticket: s.ticket ?? m?.ticket, label: s.label ?? m?.label ?? '',
      shots: s.shots.map(x => ({ path: x.raw })), best: 0,
      sceneId: s.sceneId ?? m?.sceneId ?? cfg.scenes[0]?.id ?? '', frameId: s.frameId ?? m?.frameId,
      copies: m?.copies ?? cfg.staff.copies, printed: s.printed, busy: null, failed: null, compositePath: s.composite
    }
  }
  private async loadThumbs() {
    const todo = this.items.filter(i => i.compositePath && !i.thumb)
    let next = 0
    const worker = async () => {
      while (next < todo.length) {
        const it = todo[next++]
        try {
          const url = await booth().library.imageUrl(it.compositePath!)
          if (!url) continue
          const thumb = await (await this.eng()).call<string>('thumb', { url, max: 640 })
          this.patch(it.key, { thumb })
        } catch { /* leave blank */ }
      }
    }
    await Promise.all([worker(), worker()])
  }
  /** burst filmstrip thumbs for a reloaded item */
  async loadShotThumbs(key: string) {
    const it = this.get(key); if (!it) return
    for (let n = 0; n < it.shots.length; n++) {
      const cur = this.get(key); if (!cur || cur.shots[n].thumb || !cur.shots[n].path) continue
      try {
        const url = await booth().library.imageUrl(cur.shots[n].path!)
        const thumb = await (await this.eng()).call<string>('thumb', { url, max: 360 })
        this.patch(key, i => ({ shots: i.shots.map((s, j) => j === n ? { ...s, thumb } : s) }))
      } catch { /* ignore */ }
    }
  }
  /** the full-size print sheet for the detail view */
  async fullSheet(key: string): Promise<string | undefined> {
    const it = this.get(key); if (!it?.compositePath) return undefined
    try { return (await booth().library.imageUrl(it.compositePath)) || undefined } catch { return undefined }
  }

  // ─── capture ───
  /** Returns right away. Frames: transferred ImageBitmaps (webcam) or data/object urls (tethered camera). */
  capture(frames: Frame[], sceneId: string, frameId?: string): string {
    const cfg = this.cfg!
    const t0 = performance.now()
    const key = `t${Date.now().toString(36)}${(++this.seq).toString(36)}`
    const item: Item = {
      key, createdAt: Date.now(), ticket: this.takeTicket(), label: '', shots: frames.map(() => ({})), best: 0,
      sceneId, frameId, copies: cfg.staff.copies, printed: 0, busy: 'processing', failed: null
    }
    this.items = [item, ...this.items]; this.saveMeta(item); this.emit()
    this.onAnnounce(`${this.ticketLabel(item.ticket)} captured`)
    void this.process(key, frames, t0)
    return key
  }

  private async process(key: string, frames: Frame[], t0: number, resume?: { sessionId: string }) {
    const cfg = this.cfg!
    const ck = (n: number) => `${key}#${n}`
    try {
      const eng = await this.eng()
      const multi = cfg.layout.photosPerSheet > 1
      const ingest = (n: number) => {
        const f = frames[n]
        return eng.call<IngestResult>('ingest', { cacheKey: ck(n), bitmap: f.bitmap, url: f.url, key: cfg.settings.key, maxDim: KEY_MAX_DIM, hold: true }, f.bitmap ? [f.bitmap] : [])
      }
      // key frame 0 while the session is being created (worker handles requests in order)
      const ing: Promise<IngestResult>[] = [ingest(0)]
      if (multi) for (let n = 1; n < frames.length; n++) ing.push(ingest(n))
      const s = resume ? { id: resume.sessionId } : await booth().session.start()
      this.patch(key, { sessionId: s.id })
      const it0 = this.get(key)!
      this.sync({ ...it0, sessionId: s.id })
      const extra = await this.shareExtra(s.id)
      let sent!: () => void
      const composeSent = new Promise<void>(r => { sent = r })
      const compose = this.composeFor({ ...it0, sessionId: s.id }, multi ? frames.map((_, n) => n) : [0], extra, sent)
      // remaining burst frames key behind the composite (the worker runs requests in order), so they never delay it
      await Promise.race([composeSent, compose.catch(() => undefined)])
      if (!multi) for (let n = 1; n < frames.length; n++) ing.push(ingest(n))
      const raws = frames.map((_, n) => eng.call<RawResult>('encodeRaw', { cacheKey: ck(n) }))
      const res = await compose
      await Promise.all(ing)
      await this.saveSheet(key, s.id, res)
      const readyMs = performance.now() - t0
      this.patch(key, { readyMs })
      this.record({ ticket: it0.ticket, frames: frames.length, captureToReadyMs: readyMs, workerMs: res.ms, workerMode: eng.mode })
      // raw originals are saved after the composite is on screen
      void (async () => {
        for (let n = 0; n < raws.length; n++) {
          try {
            const r = await raws[n]
            this.patch(key, i => ({ shots: i.shots.map((x, j) => j === n ? { ...x, thumb: r.thumbUrl } : x) }))
            const sess = await booth().session.saveShot(s.id, r.rawUrl)
            this.patch(key, i => ({ shots: i.shots.map((x, j) => j === n ? { ...x, path: sess.shots[n]?.raw ?? x.path } : x) }))
          } catch { /* the sheet is saved; a missing raw only disables re-keying later */ }
        }
      })()
      this.onAnnounce(`${this.ticketLabel(it0.ticket)} ready`)
      if (cfg.staff.autoPrint) await this.print(key)
    } catch (e) {
      this.patch(key, { busy: null, failed: { stage: 'process', msg: e instanceof Error ? e.message : 'processing failed' } })
      this.onAnnounce(`${this.ticketLabel(this.get(key)?.ticket)} failed, tap retry`)
      this.keepForRetry.set(key, frames)
    }
  }
  private keepForRetry = new Map<string, Frame[]>()

  private record(r: PerfRecord) {
    const w = window as unknown as { __staffPerf?: PerfRecord[] }
    ;(w.__staffPerf ??= []).push(r)
  }

  private async shareExtra(sessionId: string): Promise<{ qr?: boolean[][] }> {
    const cfg = this.cfg!
    if (!cfg.shareEnabled) return {}
    let p = this.qr.get(sessionId)
    if (!p) {
      p = booth().share.reserve(sessionId)
        .then(r => r ? { qr: cfg.layout.qrCode ? qrMatrix(r.guestUrl) : undefined } : null)
        .catch(() => null)
      this.qr.set(sessionId, p)
    }
    const r = await p
    if (r) this.patch(this.items.find(i => i.sessionId === sessionId)?.key ?? '', { sharing: true })
    return r ?? {}
  }

  private async composeFor(it: Item, shotIdx: number[], extra: { qr?: boolean[][] }, onSent?: () => void): Promise<ComposeResult> {
    const cfg = this.cfg!
    const eng = await this.eng()
    const scene = cfg.scenes.find(s => s.id === it.sceneId) ?? cfg.scenes[0]
    if (!scene) throw new Error('no scenes are set up')
    const frame = cfg.frames.find(f => f.id === it.frameId)
    const [sceneUrl, frameUrl] = await Promise.all([booth().library.imageUrl(scene.file), frame ? booth().library.imageUrl(frame.file) : Promise.resolve('')])
    const [outW, outH] = cfg.layout.photosPerSheet === 1 ? [1200, 1800] : [800, 1200]
    const footerText = `${this.ticketLabel(it.ticket)} · ${cfg.layout.footerText ?? cfg.settings.venueName}`
    const order = shotIdx.length > 1 ? [shotIdx.includes(it.best) ? it.best : shotIdx[0], ...shotIdx.filter(n => n !== it.best)] : [shotIdx[0] ?? it.best]
    const base = {
      key: cfg.settings.key, keyMaxDim: KEY_MAX_DIM, scene: { file: scene.file, url: sceneUrl, anchor: scene.anchor },
      frame: frame && frameUrl ? { file: frame.file, url: frameUrl } : undefined,
      layout: cfg.layout, footerText, qr: extra.qr, outW, outH
    }
    const shots = (urls: Record<string, string>) => order.map(n => ({ cacheKey: `${it.key}#${n}`, url: urls[`${it.key}#${n}`] }))
    try { const p = eng.call<ComposeResult>('compose', { ...base, shots: shots({}) }); onSent?.(); return await p }
    catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith(NEEDRAW)) throw e
      // the key cache no longer has these frames (reload / many captures): re-key from the saved raw files
      const urls: Record<string, string> = {}
      for (const n of order) {
        const p = it.shots[n]?.path
        if (p) urls[`${it.key}#${n}`] = await booth().library.imageUrl(p)
      }
      return eng.call<ComposeResult>('compose', { ...base, shots: shots(urls) })
    } finally { onSent?.() }
  }

  private async saveSheet(key: string, sessionId: string, res: ComposeResult) {
    const sess = await booth().session.saveComposite(sessionId, res.sheetUrl)
    this.patch(key, { thumb: res.thumbUrl, compositePath: sess.composite ?? 'saved', busy: null, failed: null })
    this.watchShare()
  }

  // ─── edits ───
  /** change scene / frame / best-of-burst: recomposes from the kept raw + key, no recapture */
  async recompose(key: string, p: { sceneId?: string; frameId?: string | null; best?: number }) {
    const it = this.get(key); if (!it) return
    this.patch(key, { ...(p.sceneId ? { sceneId: p.sceneId } : {}), ...(p.frameId !== undefined ? { frameId: p.frameId ?? undefined } : {}), ...(p.best !== undefined ? { best: p.best } : {}) })
    if (this.running.has(key)) { this.queued.set(key, { ...this.queued.get(key), ...p }); return }
    if (!it.sessionId) return // still creating its first composite; the new choice is applied on the next pass
    this.running.add(key)
    this.patch(key, { busy: 'processing', failed: null })
    try {
      const cur = this.get(key)!
      const multi = this.cfg!.layout.photosPerSheet > 1
      const extra = await this.shareExtra(cur.sessionId!)
      const res = await this.composeFor(cur, multi ? cur.shots.map((_, n) => n) : [cur.best], extra)
      await this.saveSheet(key, cur.sessionId!, res)
      this.sync(this.get(key)!)
      this.onAnnounce(`${this.ticketLabel(cur.ticket)} updated`)
    } catch (e) {
      this.patch(key, { busy: null, failed: { stage: 'process', msg: e instanceof Error ? e.message : 'could not rebuild the picture' } })
    } finally {
      this.running.delete(key)
      const q = this.queued.get(key)
      if (q) { this.queued.delete(key); void this.recompose(key, q) }
    }
  }

  async print(key: string, copies?: number) {
    const it = this.get(key); if (!it?.sessionId) return
    const n = copies ?? it.copies
    this.patch(key, { busy: 'printing', failed: null })
    try {
      await booth().printer.print(it.sessionId, n)
      this.patch(key, i => ({ busy: null, printed: i.printed + n }))
      this.onAnnounce(`${this.ticketLabel(it.ticket)} printed`)
    } catch (e) {
      this.patch(key, { busy: null, failed: { stage: 'print', msg: e instanceof Error ? e.message : 'print failed' } })
      this.onAnnounce(`${this.ticketLabel(it.ticket)} print failed`)
    }
  }

  async retry(key: string) {
    const it = this.get(key); if (!it?.failed) return
    if (it.failed.stage === 'print') return this.print(key)
    const frames = this.keepForRetry.get(key)
    if (frames && !it.sessionId) { // never got a session: rerun the whole pipeline with the frames we kept
      this.keepForRetry.delete(key)
      this.patch(key, { busy: 'processing', failed: null })
      return this.process(key, frames, performance.now())
    }
    return this.recompose(key, {})
  }

  setLabel(key: string, label: string) { this.patch(key, { label }); const i = this.get(key); if (i) this.sync(i) }
  setCopies(key: string, copies: number) { this.patch(key, { copies: Math.min(10, Math.max(1, copies)) }); const i = this.get(key); if (i) this.saveMeta(i) }

  /** remove from today's list (files stay on disk; the session is marked so it drops out of stats) */
  remove(key: string) {
    const it = this.get(key); if (!it) return
    if (it.sessionId) { this.hidden.add(it.sessionId); ls.set(HIDDEN_KEY, [...this.hidden].slice(-500)); void booth().session.update?.(it.sessionId, { test: true })?.catch?.(() => {}) }
    this.items = this.items.filter(i => i.key !== key); this.emit()
    void this.eng().then(e => e.call('forget', { prefix: key })).catch(() => {})
    this.onAnnounce(`${this.ticketLabel(it.ticket)} removed`)
  }

  /** undo a remove */
  restore(it: Item) {
    if (this.items.some(i => i.key === it.key)) return
    if (it.sessionId) { this.hidden.delete(it.sessionId); ls.set(HIDDEN_KEY, [...this.hidden]); void booth().session.update?.(it.sessionId, { test: false })?.catch?.(() => {}) }
    this.items = [...this.items, it].sort((a, b) => b.createdAt - a.createdAt); this.emit()
    this.onAnnounce(`${this.ticketLabel(it.ticket)} is back`)
  }

  // ─── share upload progress (header + per-item "sharing" chip) ───
  private watchShare() {
    if (this.shareTimer || !this.cfg?.shareEnabled) return
    let n = 0
    const tick = async () => {
      n++
      const st = await booth().share.status().catch(() => ({ pending: 0, failed: 0, total: 0 }))
      if (st.pending === 0 || n > 40) {
        window.clearInterval(this.shareTimer); this.shareTimer = 0
        this.items = this.items.map(i => i.sharing ? { ...i, sharing: false } : i); this.emit()
      }
    }
    this.shareTimer = window.setInterval(tick, 2000)
  }
  dispose() { window.clearInterval(this.shareTimer); this.shareTimer = 0 }
}
