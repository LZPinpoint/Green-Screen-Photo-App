import { join } from 'node:path'
import sharp from 'sharp'
import type { CameraDriver, PrinterDriver, PrintSize, Session } from '@shared/types'
import { CameraManager } from './camera/manager'
import { SimulatedCamera } from './camera/simulated'
import { GPhoto2Camera } from './camera/gphoto2'
import { DigiCamControlCamera } from './camera/digicam'
import { PrintQueue } from './printer/queue'
import { VirtualPdfPrinter } from './printer/virtual'
import { PRINT_INCHES } from './printer/sizes'
import { SettingsStore } from './store/settings'
import { SessionStore, scheduleDaily } from './store/sessions'
import { LibraryStore } from './store/library'
import { AiCutout } from './ai/cutout'
import { ShareService } from './shareService'
import { log } from './logger'

export interface ServiceOptions {
  dataDir: string
  /** Directory with bundled resources (resources/ in dev, process.resourcesPath in prod). */
  resourcesDir?: string
  realPrinter?: PrinterDriver
  dslr?: CameraDriver[]
  simulated?: CameraDriver
  printRetryDelayMs?: number
}
export interface Services {
  settings: SettingsStore; sessions: SessionStore; library: LibraryStore
  cameras: CameraManager; printQueue: PrintQueue; cutout: AiCutout; share: ShareService
  stopCleanup(): void
}

/** Pick the paper size whose aspect matches the composite (either orientation); else the default layout's size. */
export function sizeFromDims(w: number, h: number, fallback: PrintSize): PrintSize {
  const r = Math.min(w, h) / Math.max(w, h)
  let best: PrintSize | undefined, bestDiff = 0.02
  for (const [k, v] of Object.entries(PRINT_INCHES) as [PrintSize, { w: number; h: number }][]) {
    const d = Math.abs(r - v.w / v.h)
    if (d < bestDiff) { best = k; bestDiff = d }
  }
  return best ?? fallback
}

export function createServices(o: ServiceOptions): Services {
  const settings = new SettingsStore(o.dataDir)
  const sessions = new SessionStore(o.dataDir)
  const library = new LibraryStore(o.dataDir, o.resourcesDir ? [o.resourcesDir] : [])
  const dslr = o.dslr ?? (process.platform === 'win32' ? [new DigiCamControlCamera()] : [new GPhoto2Camera()])
  const cameras = new CameraManager({ simulated: o.simulated ?? new SimulatedCamera(), dslr })
  const printQueue = new PrintQueue({
    real: o.realPrinter,
    virtual: new VirtualPdfPrinter(join(o.dataDir, 'prints')),
    getSettings: () => settings.get(),
    getSession: id => sessions.get(id),
    addPrinted: (id, n) => sessions.update(id, s => { s.printed += n }),
    compositePath: (s: Session) => (s.composite ? join(o.dataDir, s.composite) : undefined),
    sizeFor: async s => {
      const layouts = await library.layouts()
      const st = await settings.get()
      const fallback: PrintSize = layouts.find(l => l.id === st.defaultLayoutId)?.size ?? '4x6'
      try { const m = await sharp(join(o.dataDir, s.composite!)).metadata(); return sizeFromDims(m.width ?? 0, m.height ?? 0, fallback) } catch { return fallback }
    },
    retryDelayMs: o.printRetryDelayMs
  })
  const cutout = new AiCutout([join(o.dataDir, 'models'), ...(o.resourcesDir ? [join(o.resourcesDir, 'models')] : [])])
  const stopCleanup = scheduleDaily(async () => {
    const days = (await settings.get()).retentionDays ?? 30
    const n = await sessions.purgeOlderThan(days)
    if (n) log.info(`retention: purged files of ${n} sessions older than ${days}d`)
  }, e => log.error('retention cleanup failed', e))
  const share = new ShareService({ dataDir: o.dataDir, settings, sessions })
  return { settings, sessions, library, cameras, printQueue, cutout, share, stopCleanup }
}
