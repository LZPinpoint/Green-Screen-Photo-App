// Pure helpers for the admin UI (no DOM / no window.booth) — unit tested in tests/admin.
import { DEFAULT_KEY, DEFAULT_SETTINGS } from '../../shared/types'
import type { KeyParams, VenueSettings, Session, ShareSettings } from '../../shared/types'

export interface Summary { sessions: number; prints: number; byScene: Record<string, number>; byDay: Record<string, number> }

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Last `n` days ending at `today`, zero-filled, oldest first. */
export function shapeByDay(byDay: Record<string, number>, n = 14, today = new Date()): { day: string; label: string; count: number }[] {
  const out: { day: string; label: string; count: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const k = dayKey(d)
    out.push({ day: k, label: `${d.getMonth() + 1}/${d.getDate()}`, count: byDay[k] ?? 0 })
  }
  return out
}

export function topScenes(byScene: Record<string, number>, names: Record<string, string> = {}, limit = 5) {
  return Object.entries(byScene)
    .map(([id, count]) => ({ id, name: names[id] ?? id, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export const sessionsToday = (s: Summary, today = new Date()) => s.byDay[dayKey(today)] ?? 0

/** Nice axis max for bar charts. */
export function niceMax(v: number): number {
  if (v <= 4) return 4
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function sessionLabel(s: Session): string {
  const d = new Date(s.createdAt)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`.toLowerCase()
}

// ─── settings import/export ───
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const HEX = /^#[0-9a-fA-F]{6}$/

export interface ImportResult { ok: boolean; settings?: Partial<VenueSettings>; errors: string[] }

/** Validate + sanitise a settings JSON blob. Unknown keys are dropped; out-of-range numbers are clamped. */
export function validateSettingsImport(raw: unknown): ImportResult {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['file is not a settings object'] }
  const r = raw as Record<string, any>
  const out: Partial<VenueSettings> = {}
  const str = (k: 'venueName' | 'welcomeText' | 'defaultLayoutId' | 'cameraId' | 'printerName') => {
    if (r[k] === undefined) return
    if (typeof r[k] !== 'string') errors.push(`${k} must be text`)
    else (out as any)[k] = r[k]
  }
  ;(['venueName', 'welcomeText', 'defaultLayoutId', 'cameraId', 'printerName'] as const).forEach(str)
  const num = (k: 'idleTimeoutSec' | 'countdownSec' | 'maxPrintsPerSession', lo: number, hi: number) => {
    if (r[k] === undefined) return
    if (!isNum(r[k])) errors.push(`${k} must be a number`)
    else out[k] = Math.round(clamp(r[k], lo, hi))
  }
  num('idleTimeoutSec', 10, 600); num('countdownSec', 1, 10); num('maxPrintsPerSession', 1, 20)
  if (r.adminPin !== undefined) {
    if (typeof r.adminPin !== 'string' || !/^\d{4,8}$/.test(r.adminPin)) errors.push('adminPin must be 4-8 digits')
    else out.adminPin = r.adminPin
  }
  if (r.brand !== undefined) {
    if (typeof r.brand !== 'object' || r.brand === null) errors.push('brand must be an object')
    else if (typeof r.brand.accent !== 'string' || !HEX.test(r.brand.accent)) errors.push('brand.accent must be a #rrggbb color')
    else out.brand = { accent: r.brand.accent, ...(typeof r.brand.logoFile === 'string' ? { logoFile: r.brand.logoFile } : {}) }
  }
  if (r.key !== undefined) {
    const k = r.key
    if (typeof k !== 'object' || k === null) errors.push('key must be an object')
    else {
      const key: KeyParams = { ...DEFAULT_KEY }
      const kc = k.keyColor
      if (kc !== undefined) {
        if (Array.isArray(kc) && kc.length === 3 && kc.every(isNum)) key.keyColor = kc.map(v => Math.round(clamp(v, 0, 255))) as [number, number, number]
        else errors.push('key.keyColor must be [r,g,b]')
      }
      for (const [f, lo, hi] of [['similarity', 0, 1], ['smoothness', 0, 1], ['spill', 0, 1], ['edgeShrink', 0, 4]] as const) {
        if (k[f] === undefined) continue
        if (!isNum(k[f])) errors.push(`key.${f} must be a number`)
        else key[f] = clamp(k[f], lo, hi)
      }
      if (k.mode !== undefined) {
        if (['chroma', 'ai', 'auto'].includes(k.mode)) key.mode = k.mode
        else errors.push('key.mode must be chroma, ai or auto')
      }
      if (k.stage !== undefined && k.stage !== null) {
        // 'stage' = margins of the frame to discard (the camera sees past the green screen): each side 0..0.45
        const st = k.stage
        if (typeof st !== 'object') errors.push('key.stage must be {left,right,top,bottom}')
        else {
          const side = (v: unknown) => (isNum(v) ? clamp(v, 0, 0.45) : 0)
          const s = { left: side(st.left), right: side(st.right), top: side(st.top), bottom: side(st.bottom) }
          if (s.left || s.right || s.top || s.bottom) key.stage = s
        }
      }
      out.key = key
    }
  }
  if (r.mode !== undefined) {
    if (r.mode === 'staff' || r.mode === 'kiosk') out.mode = r.mode
    else errors.push('mode must be staff or kiosk')
  }
  if (r.staff !== undefined) {
    const v = validateStaffDraft({ ...staffToDraft(DEFAULT_SETTINGS), ...(typeof r.staff === 'object' && r.staff ? r.staff : {}), mode: 'staff' } as StaffDraft)
    if (typeof r.staff !== 'object' || r.staff === null || Array.isArray(r.staff)) errors.push('staff must be an object')
    else if (!v.ok) errors.push(...Object.values(v.errors).map(e => 'staff: ' + e))
    else out.staff = { ...v.staff!, ...(typeof r.staff.defaultSceneId === 'string' ? { defaultSceneId: r.staff.defaultSceneId } : {}) }
  }
  if (r.share !== undefined) {
    const sh = r.share
    if (typeof sh !== 'object' || sh === null || Array.isArray(sh)) errors.push('share must be an object')
    else {
      // secrets are never imported: the booth key must be re-entered on the sharing tab
      const d = shareToDraft({ enabled: !!sh.enabled, baseUrl: typeof sh.baseUrl === 'string' ? sh.baseUrl : '', venueId: typeof sh.venueId === 'string' ? sh.venueId : '', apiKey: '', retentionDays: isNum(sh.retentionDays) ? sh.retentionDays : undefined })
      const v = validateShare({ ...d, enabled: false })
      if (!v.ok) errors.push(...Object.values(v.errors).map(e => 'share: ' + e))
      else { const { apiKey: _k, ...pub } = draftToShare(d); out.share = pub as ShareSettings }
    }
  }
  if (Object.keys(out).length === 0 && errors.length === 0) errors.push('no recognised settings found')
  return { ok: errors.length === 0, settings: errors.length ? undefined : out, errors }
}

/** Export never includes secrets: share.apiKey is stripped. */
export function exportSettingsJson(s: VenueSettings): string {
  const { share, ...rest } = s
  const out: Record<string, unknown> = { ...rest }
  if (share) { const { apiKey: _k, ...pub } = share; out.share = pub }
  return JSON.stringify(out, null, 2)
}

// ─── sharing ───
export const DEFAULT_RETENTION_DAYS = 30
export interface ShareDraft { enabled: boolean; baseUrl: string; venueId: string; apiKey: string; retentionDays: number | '' }
export const emptyShare = (): ShareDraft => ({ enabled: false, baseUrl: '', venueId: '', apiKey: '', retentionDays: DEFAULT_RETENTION_DAYS })
export function shareToDraft(s?: ShareSettings): ShareDraft {
  return { enabled: s?.enabled ?? false, baseUrl: s?.baseUrl ?? '', venueId: s?.venueId ?? '', apiKey: s?.apiKey ?? '', retentionDays: s?.retentionDays ?? DEFAULT_RETENTION_DAYS }
}
export const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost')
/** Trim + strip trailing slashes. */
export const normalizeBaseUrl = (u: string) => u.trim().replace(/\/+$/, '')
export interface ShareValidation { ok: boolean; errors: Partial<Record<'baseUrl' | 'venueId' | 'apiKey' | 'retentionDays', string>> }
/** Validate sharing settings. When disabled, nothing is required (but a filled URL must still be sane). */
export function validateShare(d: ShareDraft): ShareValidation {
  const errors: ShareValidation['errors'] = {}
  const url = normalizeBaseUrl(d.baseUrl)
  if (!url) { if (d.enabled) errors.baseUrl = 'enter the server address, e.g. https://photos.example.com' }
  else {
    let u: URL | undefined
    try { u = new URL(url) } catch { errors.baseUrl = 'that does not look like a web address' }
    if (u) {
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname))) errors.baseUrl = 'the address must start with https:// (http:// is only allowed for localhost)'
      else if (u.protocol !== 'https:' && u.protocol !== 'http:') errors.baseUrl = 'the address must start with https://'
    }
  }
  if (d.enabled && !d.venueId.trim()) errors.venueId = 'enter the venue id'
  if (d.venueId.trim() && !/^[A-Za-z0-9_-]+$/.test(d.venueId.trim())) errors.venueId = 'venue id may only use letters, numbers, - and _'
  if (!d.apiKey.trim()) { if (d.enabled) errors.apiKey = 'paste the booth key for this venue' }
  const r = d.retentionDays
  if (r !== '' && (!Number.isInteger(Number(r)) || Number(r) < 1 || Number(r) > 3650)) errors.retentionDays = 'keep photos between 1 and 3650 days'
  if (r === '' && d.enabled) errors.retentionDays = 'enter how many days to keep photos'
  return { ok: Object.keys(errors).length === 0, errors }
}
export function draftToShare(d: ShareDraft): ShareSettings {
  return { enabled: d.enabled, baseUrl: normalizeBaseUrl(d.baseUrl), venueId: d.venueId.trim(), apiKey: d.apiKey.trim(), retentionDays: d.retentionDays === '' ? DEFAULT_RETENTION_DAYS : Number(d.retentionDays) }
}
export type HealthResult = { ok: true; ms: number } | { ok: false; kind: 'http' | 'network'; status?: number }
/** Plain-english guidance for a connection test result. */
export function healthMessage(r: HealthResult): { tone: 'ok' | 'bad'; text: string } {
  if (r.ok) return { tone: 'ok', text: `server answered in ${r.ms} ms. the address looks right.` }
  if (r.kind === 'http') return { tone: 'bad', text: `the server answered with an error (${r.status}). check the address; it should be the root of your Cloudflare worker, with nothing after it.` }
  return { tone: 'bad', text: 'could not reach the server. this could mean the booth is offline, the address is wrong, or the browser blocked the check. this check runs from the booth; if it fails but uploads work, ignore it.' }
}
/** Chip tone + label for the upload queue. */
export function shareStatusView(s?: { pending: number; failed: number; total: number }, enabled = true): { tone: 'ok' | 'warn' | 'bad' | 'idle'; text: string } {
  if (!enabled) return { tone: 'idle', text: 'sharing is off' }
  if (!s) return { tone: 'idle', text: 'checking…' }
  if (s.failed > 0) return { tone: 'bad', text: `${s.failed} upload${s.failed === 1 ? '' : 's'} failed · ${s.pending} waiting` }
  if (s.pending > 0) return { tone: 'warn', text: `${s.pending} upload${s.pending === 1 ? '' : 's'} waiting` }
  return { tone: 'ok', text: `all caught up · ${s.total} shared` }
}

// ─── frame analysis → tips ───
export interface FrameStats { leftLum: number; rightLum: number; topLum: number; bottomLum: number; centerLum: number; greenCover: number; edgeNoise: number }
export interface QualityReport { score: number; label: 'good' | 'ok' | 'poor'; tips: string[] }

/** Compute border luminance / green coverage from raw RGBA (downsampled) + alpha matte quality. */
export function analyzeFrame(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, key: [number, number, number], alpha?: Uint8ClampedArray | Uint8Array): FrameStats {
  const lum = (i: number) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  const band = (x0: number, x1: number, y0: number, y1: number) => {
    let s = 0, n = 0
    const sx = Math.max(1, Math.floor((x1 - x0) / 24)), sy = Math.max(1, Math.floor((y1 - y0) / 24))
    for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) { s += lum((y * w + x) * 4); n++ }
    return n ? s / n : 0
  }
  const bw = Math.max(1, Math.floor(w * 0.12)), bh = Math.max(1, Math.floor(h * 0.12))
  let green = 0, total = 0
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)))
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4
    const d = Math.hypot(rgba[i] - key[0], rgba[i + 1] - key[1], rgba[i + 2] - key[2])
    if (d < 90) green++
    total++
  }
  let edgeNoise = 0
  if (alpha) {
    let semi = 0, n = 0
    for (let i = 0; i < w * h; i += step) { const a = alpha[i * 4 + 3] ?? alpha[i]; if (a > 12 && a < 243) semi++; n++ }
    edgeNoise = n ? semi / n : 0
  }
  return {
    leftLum: band(0, bw, 0, h), rightLum: band(w - bw, w, 0, h), topLum: band(0, w, 0, bh), bottomLum: band(0, w, h - bh, h),
    centerLum: band(Math.floor(w * 0.35), Math.floor(w * 0.65), Math.floor(h * 0.3), Math.floor(h * 0.7)),
    greenCover: total ? green / total : 0, edgeNoise
  }
}

/** Plain-english tips from stats. */
export function tipsFromStats(st: FrameStats): QualityReport {
  const tips: string[] = []
  let score = 100
  const sides: [string, number][] = [['left', st.leftLum], ['right', st.rightLum], ['top', st.topLum], ['bottom', st.bottomLum]]
  const mean = sides.reduce((a, [, v]) => a + v, 0) / 4 || 1
  const dark = sides.slice().sort((a, b) => a[1] - b[1])[0]
  const spread = (Math.max(...sides.map(s => s[1])) - Math.min(...sides.map(s => s[1]))) / mean
  if (spread > 0.25) { tips.push(`uneven lighting — add light to the ${dark[0]} edge`); score -= Math.min(30, spread * 50) }
  if (mean < 60) { tips.push('screen is dim — raise the screen lights or open the lens a stop'); score -= 20 }
  if (mean > 215) { tips.push('screen is overexposed — lower the lights or exposure to keep the green saturated'); score -= 15 }
  if (st.greenCover < 0.25) { tips.push('not much green found — click the screen to sample its color, or move closer to the screen'); score -= 25 }
  if (st.edgeNoise > 0.2) { tips.push('lots of half-transparent pixels — raise smoothness or lower similarity, and check for wrinkles'); score -= 20 }
  else if (st.edgeNoise < 0.005 && st.greenCover > 0.25) { tips.push('edges look very hard — try a little more smoothness'); score -= 5 }
  if (!tips.length) tips.push('looks good — even light, clean edges')
  score = Math.round(Math.max(0, Math.min(100, score)))
  return { score, label: score >= 75 ? 'good' : score >= 50 ? 'ok' : 'poor', tips }
}

// ─── test lab ───
export type CheckState = 'unset' | 'pass' | 'fail'
export interface CheckItem { id: string; group: string; text: string; hint?: string }
export const CHECKLIST: CheckItem[] = [
  { id: 'a-flow60', group: 'acceptance', text: 'guest completes flow untouched in < 60 s', hint: 'stopwatch from tap-to-start to thank-you' },
  { id: 'a-idle', group: 'acceptance', text: 'idle timeout returns to start, no previous guest photo visible' },
  { id: 'a-key5', group: 'acceptance', text: 'key quality ok on 5 varied people', hint: 'hair, glasses, dark skin, white shirt, green-ish shirt' },
  { id: 'a-replug', group: 'acceptance', text: 'dslr capture works after usb replug' },
  { id: 'a-print', group: 'acceptance', text: 'print matches preview, correct size, copy limit enforced' },
  { id: 'a-offline', group: 'acceptance', text: 'works offline (wifi off)' },
  { id: 'a-pin', group: 'acceptance', text: 'admin pin blocks guests; settings persist across restart' },
  { id: 'a-stats', group: 'acceptance', text: 'stats count matches actual prints' },
  { id: 'l2-webcam', group: 'level 2 · webcam', text: 'calibrated green screen; edges ok on hair, glasses, green clothing' },
  { id: 'l3-dslr', group: 'level 3 · dslr', text: 'test capture to preview under 3 s', hint: 'hardware tab → test capture' },
  { id: 'l4-print', group: 'level 4 · printer', text: 'test print: right size, borders, color, no crop', hint: '4x6 = 1200x1800' },
  { id: 'l5-soak', group: 'level 5 · soak', text: '100 sessions back-to-back with no crash' },
  { id: 'l5-unplug', group: 'level 5 · soak', text: 'unplug camera / printer mid-session, out-of-paper, power cycle: app recovers, no lost session' },
  { id: 'l6-pilot', group: 'level 6 · pilot', text: 'one exhibit day with staff observer' }
]

export function checklistProgress(state: Record<string, CheckState>) {
  const total = CHECKLIST.length
  const pass = CHECKLIST.filter(c => state[c.id] === 'pass').length
  const fail = CHECKLIST.filter(c => state[c.id] === 'fail').length
  return { total, pass, fail, open: total - pass - fail }
}

export interface StageTiming { stage: string; ms: number; ok: boolean; note?: string }
export interface ReportInput { venue: string; when: Date; checks: Record<string, CheckState>; notes?: Record<string, string>; selfTest?: StageTiming[] }

export function buildReportJson(r: ReportInput) {
  return {
    venue: r.venue, generatedAt: r.when.toISOString(), progress: checklistProgress(r.checks),
    items: CHECKLIST.map(c => ({ id: c.id, group: c.group, text: c.text, result: r.checks[c.id] ?? 'unset', note: r.notes?.[c.id] ?? '' })),
    selfTest: r.selfTest ?? []
  }
}

export function buildReportMarkdown(r: ReportInput): string {
  const p = checklistProgress(r.checks)
  const L: string[] = [`# imagine booth test report`, ``, `- venue: ${r.venue}`, `- date: ${r.when.toISOString()}`, `- result: ${p.pass} pass · ${p.fail} fail · ${p.open} open (of ${p.total})`, ``]
  let g = ''
  for (const c of CHECKLIST) {
    if (c.group !== g) { g = c.group; L.push(`## ${g}`) }
    const s = r.checks[c.id] ?? 'unset'
    const note = r.notes?.[c.id]
    L.push(`- [${s === 'pass' ? 'x' : ' '}] ${c.text}${s === 'fail' ? ' **FAIL**' : s === 'unset' ? ' _(not tested)_' : ''}${note ? ` — ${note}` : ''}`)
  }
  if (r.selfTest?.length) {
    L.push('', '## automated self-test', '', '| stage | ms | result |', '|---|---:|---|')
    for (const s of r.selfTest) L.push(`| ${s.stage} | ${Math.round(s.ms)} | ${s.ok ? 'ok' : 'FAIL'}${s.note ? ' — ' + s.note : ''} |`)
    L.push('', `total: ${Math.round(r.selfTest.reduce((a, s) => a + s.ms, 0))} ms`)
  }
  return L.join('\n') + '\n'
}

export const resetKey = (): KeyParams => ({ ...DEFAULT_KEY, keyColor: [...DEFAULT_KEY.keyColor] as [number, number, number] })
export const defaultSettings = (): VenueSettings => structuredClone(DEFAULT_SETTINGS)

export const rgbToHex = ([r, g, b]: number[]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
export const SIZE_PX: Record<string, [number, number]> = { '4x6': [1200, 1800], '2x6-strip': [600, 1800], '5x7': [1500, 2100], '6x8': [1800, 2400] }

/** Merge an imported (key-less) share block over the current one; the booth key always stays local, and sharing only stays on if a key exists. */
export function mergeImportedShare(cur: ShareSettings | undefined, imp: ShareSettings): ShareSettings {
  const apiKey = cur?.apiKey ?? ''
  return { ...imp, apiKey, enabled: imp.enabled && !!apiKey }
}
/** Sessions staff should see: hardware-test sessions are hidden. */
export const realSessions = (l: Session[]): Session[] => l.filter(s => !s.test)


// ─── operating mode (staff console vs self-serve kiosk) ───
export const COPIES_RANGE: [number, number] = [1, 10]
export const COUNTDOWN_RANGE: [number, number] = [0, 10]
/** keys the console already uses: they can't also be the shutter */
const RESERVED_KEYS = new Set(['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ArrowLeft', 'ArrowRight', '[', ']', '?', 'p', 'P', 'r', 'R', 'f', 'F', ...'123456789'.split('')])
export const isReservedCaptureKey = (k: string) => RESERVED_KEYS.has(k)
/** a key as people say it: ' ' -> space, 'PageDown' -> page down */
export function captureKeyLabel(k: string): string {
  if (k === ' ') return 'space'
  const map: Record<string, string> = { Enter: 'enter', PageDown: 'page down', PageUp: 'page up', ArrowUp: 'up arrow', ArrowDown: 'down arrow', Backspace: 'backspace' }
  return map[k] ?? k.toLowerCase()
}
export const normalizeTicketPrefix = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase()

export interface StaffDraft {
  mode: 'staff' | 'kiosk'
  autoPrint: boolean
  copies: number | ''
  ticketPrefix: string
  captureKey: string
  countdownSec: number | ''
}
export function staffToDraft(s: Pick<VenueSettings, 'mode' | 'staff'>): StaffDraft {
  const d = DEFAULT_SETTINGS.staff!, st = s.staff ?? d
  return {
    mode: s.mode === 'kiosk' ? 'kiosk' : 'staff', autoPrint: st.autoPrint ?? d.autoPrint, copies: st.copies ?? d.copies,
    ticketPrefix: st.ticketPrefix ?? d.ticketPrefix, captureKey: st.captureKey || d.captureKey, countdownSec: st.countdownSec ?? d.countdownSec
  }
}
export interface StaffValidation { ok: boolean; errors: Partial<Record<'copies' | 'ticketPrefix' | 'captureKey' | 'countdownSec', string>>; mode: 'staff' | 'kiosk'; staff?: NonNullable<VenueSettings['staff']> }
export function validateStaffDraft(d: StaffDraft): StaffValidation {
  const errors: StaffValidation['errors'] = {}
  const whole = (v: unknown, [lo, hi]: [number, number]) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
  if (!whole(d.copies, COPIES_RANGE)) errors.copies = `copies must be a whole number from ${COPIES_RANGE[0]} to ${COPIES_RANGE[1]}`
  if (!whole(d.countdownSec, COUNTDOWN_RANGE)) errors.countdownSec = `countdown must be ${COUNTDOWN_RANGE[0]} (instant) to ${COUNTDOWN_RANGE[1]} seconds`
  if (!/^[A-Za-z0-9]{1,3}$/.test(d.ticketPrefix)) errors.ticketPrefix = 'ticket prefix is 1 to 3 letters or numbers, like A'
  if (!d.captureKey) errors.captureKey = 'press the key you want to use'
  else if (isReservedCaptureKey(d.captureKey)) errors.captureKey = `${captureKeyLabel(d.captureKey)} is already used for something else in staff mode — pick another key`
  const mode = d.mode === 'kiosk' ? 'kiosk' : 'staff'
  if (Object.keys(errors).length) return { ok: false, errors, mode }
  return { ok: true, errors, mode, staff: { autoPrint: !!d.autoPrint, copies: d.copies as number, ticketPrefix: d.ticketPrefix.toUpperCase(), captureKey: d.captureKey, countdownSec: d.countdownSec as number } }
}
