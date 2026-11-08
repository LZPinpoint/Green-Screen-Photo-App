// ─── Shared contracts. Every module codes against THIS file. Change only with the integrator. ───

export type ImageData64 = string // data URL (image/jpeg|png) – used across IPC for simplicity

/** Green-screen keying parameters. All 0..1 unless noted. */
export interface KeyParams {
  keyColor: [number, number, number] // sampled RGB 0..255, default [0,177,64]
  similarity: number   // how far from keyColor counts as background (default 0.40)
  smoothness: number   // edge feather (default 0.10)
  spill: number        // spill suppression strength (default 0.50)
  edgeShrink: number   // px erode of matte, 0..4 (default 1)
  mode: 'chroma' | 'ai' | 'auto'
}
export const DEFAULT_KEY: KeyParams = {
  keyColor: [0, 177, 64], similarity: 0.4, smoothness: 0.1, spill: 0.5, edgeShrink: 1, mode: 'auto'
}

export interface BackgroundScene {
  id: string
  name: string
  category: string          // e.g. "dinosaurs", "space", "art", "ancient egypt"
  file: string              // path relative to data dir backgrounds/
  thumb?: string
  /** where the subject is anchored: 0..1 of canvas */
  anchor: { x: number; y: number; scale: number }
  enabled: boolean
}

export interface FrameOverlay { id: string; name: string; file: string; enabled: boolean } // transparent PNG overlay

export type PrintSize = '4x6' | '2x6-strip' | '5x7' | '6x8'
export interface PrintLayout {
  id: string
  name: string
  size: PrintSize
  photosPerSheet: 1 | 2 | 3 | 4
  showLogo: boolean
  footerText?: string       // e.g. "Franklin Institute · 2026"
  qrCode: boolean           // link to digital download
}

export interface CameraDevice { id: string; label: string; kind: 'webcam' | 'dslr' | 'simulated' }
export interface PrinterDevice { name: string; displayName: string; isDefault: boolean; status: 'ready' | 'busy' | 'offline' | 'unknown' }

export interface Session {
  id: string
  createdAt: number
  shots: { raw: string; keyed?: string }[]   // file paths in data dir
  sceneId?: string
  frameId?: string
  composite?: string
  printed: number
  emailed?: string
  /** staff hardware tests; excluded from stats */
  test?: boolean
}

export interface VenueSettings {
  venueName: string
  welcomeText: string
  idleTimeoutSec: number
  countdownSec: number
  maxPrintsPerSession: number
  adminPin: string
  cameraId?: string
  printerName?: string
  defaultLayoutId: string
  key: KeyParams
  brand: { accent: string; logoFile?: string }  // venue can co-brand; default imagine red
  /** Digital delivery (QR + gallery + email). Absent or enabled=false => booth works fully offline, no uploads. */
  share?: ShareSettings
}
export interface ShareSettings {
  enabled: boolean
  baseUrl: string      // e.g. https://photos.example.com  (the cloud/ worker)
  venueId: string
  apiKey: string       // booth key issued for the venue
  retentionDays?: number
}
export const DEFAULT_SETTINGS: VenueSettings = {
  venueName: 'your venue', welcomeText: 'step into the story', idleTimeoutSec: 60, countdownSec: 3,
  maxPrintsPerSession: 2, adminPin: '1234', defaultLayoutId: 'classic-4x6', key: DEFAULT_KEY,
  brand: { accent: '#B80021' }
}

// ─── Driver interfaces (main process) ───
export interface CameraDriver {
  readonly kind: CameraDevice['kind']
  list(): Promise<CameraDevice[]>
  connect(id: string): Promise<void>
  /** DSLR/simulated only: capture full-res still, return JPEG bytes. Webcams capture in renderer. */
  capture(): Promise<Buffer>
  /** optional low-res live frame for preview */
  liveFrame?(): Promise<Buffer>
  disconnect(): Promise<void>
}
export interface PrinterDriver {
  list(): Promise<PrinterDevice[]>
  /** Print a finished image at physical size. Resolves when spooled. */
  print(opts: { printer: string; file: string; size: PrintSize; copies: number }): Promise<{ jobId: string }>
}

// ─── IPC surface exposed on window.booth by preload ───
export interface BoothAPI {
  camera: {
    list(): Promise<CameraDevice[]>
    connect(id: string): Promise<void>
    capture(): Promise<ImageData64>
  }
  printer: {
    list(): Promise<PrinterDevice[]>
    print(sessionId: string, copies: number): Promise<{ jobId: string }>
  }
  session: {
    start(): Promise<Session>
    saveShot(sessionId: string, dataUrl: ImageData64): Promise<Session>
    saveComposite(sessionId: string, dataUrl: ImageData64): Promise<Session>
    get(id: string): Promise<Session | undefined>
    list(limit?: number): Promise<Session[]>
  }
  library: {
    scenes(): Promise<BackgroundScene[]>
    saveScene(s: BackgroundScene, imageDataUrl?: ImageData64): Promise<void>
    deleteScene(id: string): Promise<void>
    frames(): Promise<FrameOverlay[]>
    saveFrame(f: FrameOverlay, imageDataUrl?: ImageData64): Promise<void>
    layouts(): Promise<PrintLayout[]>
    saveLayout(l: PrintLayout): Promise<void>
    imageUrl(file: string): Promise<ImageData64>
  }
  settings: { get(): Promise<VenueSettings>; set(s: Partial<VenueSettings>): Promise<VenueSettings> }
  stats: { summary(): Promise<{ sessions: number; prints: number; byScene: Record<string, number>; byDay: Record<string, number> }> }
  ai: { cutout(dataUrl: ImageData64): Promise<ImageData64> } // returns PNG with alpha
  share: {
    /** Is digital delivery configured? */
    enabled(): Promise<boolean>
    /** Reserve the guest link for this session BEFORE the print sheet is built, so the QR can be printed. null => sharing off. */
    reserve(sessionId: string): Promise<{ shareId: string; guestUrl: string } | null>
    /** Queue the gallery link by email. consent must be true. Never blocks; delivery is retried in the background. */
    email(shareId: string, email: string, consent: boolean, marketingOptIn: boolean): Promise<{ queued: boolean }>
    status(): Promise<{ pending: number; failed: number; total: number }>
  }
}
declare global { interface Window { booth: BoothAPI } }
