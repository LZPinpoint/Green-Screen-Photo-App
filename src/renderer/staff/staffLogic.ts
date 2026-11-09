// Pure helpers for the staff operator console (no DOM, no window.booth) — unit tested in tests/staff.
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { StaffSettings, Session, BackgroundScene } from '../../shared/types'
import type { KeyQuality } from '@core/index'

export const DEFAULT_STAFF: StaffSettings = DEFAULT_SETTINGS.staff as StaffSettings

/** settings.staff with every field filled and sane (older settings files have none of it). */
export function normalizeStaff(s?: Partial<StaffSettings> | null): StaffSettings {
  const d = DEFAULT_STAFF
  const num = (v: unknown, lo: number, hi: number, fb: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fb
    return Math.min(hi, Math.max(lo, n))
  }
  return {
    autoPrint: typeof s?.autoPrint === 'boolean' ? s.autoPrint : d.autoPrint,
    copies: num(s?.copies, 1, 10, d.copies),
    defaultSceneId: typeof s?.defaultSceneId === 'string' && s.defaultSceneId ? s.defaultSceneId : undefined,
    ticketPrefix: typeof s?.ticketPrefix === 'string' ? s.ticketPrefix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() : d.ticketPrefix,
    captureKey: typeof s?.captureKey === 'string' && s.captureKey.length > 0 ? s.captureKey : d.captureKey,
    countdownSec: num(s?.countdownSec, 0, 10, d.countdownSec)
  }
}

// ─── tickets ───
export const formatTicket = (prefix: string, n: number): string => `${prefix}${String(Math.max(0, Math.floor(n))).padStart(3, '0')}`

/** local-day key, e.g. 2026-11-08 */
export const localDay = (t: number | Date = Date.now()): string => {
  const d = typeof t === 'number' ? new Date(t) : t
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const isToday = (t: number, now: number = Date.now()) => localDay(t) === localDay(now)

/** 'a12', 'A012', '12', '#12' -> 12; anything else -> null */
export function parseTicketQuery(q: string, prefix = 'A'): number | null {
  const m = q.trim().toUpperCase().replace(/^#/, '').match(/^([A-Z0-9]{0,3}?)(\d{1,6})$/)
  if (!m) return null
  if (m[1] && m[1] !== prefix.toUpperCase()) return null
  return parseInt(m[2], 10)
}

/** next ticket number for the day: one more than the highest seen (stored counter or any existing item) */
export const nextTicketNumber = (stored: number, existing: (number | undefined)[]): number =>
  Math.max(stored, ...existing.map(n => n ?? 0)) + 1

export interface Matchable { ticket?: number; label?: string }
/** filter the queue by ticket number prefix match ('1' finds 1, 10..19, 100..) or by label text */
export function filterItems<T extends Matchable>(items: T[], q: string, prefix = 'A'): T[] {
  const s = q.trim().toLowerCase()
  if (!s) return items
  const t = parseTicketQuery(s, prefix)
  return items.filter(i =>
    (t !== null && i.ticket !== undefined && (i.ticket === t || String(i.ticket).startsWith(String(t)))) ||
    (i.label ?? '').toLowerCase().includes(s))
}

// ─── item status ───
export type Busy = 'processing' | 'printing' | null
export interface StatusInput { busy: Busy; status?: string; failed?: { stage: 'process' | 'print' } | null; printed: number; sharing?: boolean }
export type StatusKey = 'processing' | 'ready' | 'printing' | 'printed' | 'failed-process' | 'failed-print' | 'uploading'
export function itemStatus(i: StatusInput): { key: StatusKey; label: string; tone: 'busy' | 'ok' | 'bad' | 'idle' } {
  if (i.failed) return i.failed.stage === 'print'
    ? { key: 'failed-print', label: 'print failed · retry', tone: 'bad' }
    : { key: 'failed-process', label: 'failed · retry', tone: 'bad' }
  if (i.busy === 'processing') return { key: 'processing', label: i.status ?? 'processing', tone: 'busy' }
  if (i.busy === 'printing') return { key: 'printing', label: 'printing', tone: 'busy' }
  if (i.printed > 0) return { key: 'printed', label: i.printed > 1 ? `printed ×${i.printed}` : 'printed', tone: 'ok' }
  if (i.sharing) return { key: 'uploading', label: 'sharing', tone: 'busy' }
  return { key: 'ready', label: 'ready', tone: 'idle' }
}

// ─── green-screen health ───
export interface Health { level: 'good' | 'warn' | 'bad'; text: string }
/** plain-english advice for the attendant from the keyer's quality numbers */
export function healthFromQuality(q: Pick<KeyQuality, 'coverage' | 'edgeNoise'> & { greenFrac?: number }): Health {
  if (q.coverage < 0.1) return { level: 'bad', text: "can't see the green screen — point the camera at it and check the lights are on" }
  if (q.coverage > 0.9) return { level: 'bad', text: 'almost everything is turning green-screen — is someone wearing green?' }
  if ((q.greenFrac ?? 0) > 0.01) return { level: 'warn', text: 'green is showing on the group — move everyone 2 steps forward, away from the screen' }
  if (q.edgeNoise > 0.3) return { level: 'warn', text: 'move the group 2 steps forward — shadows on the screen are making edges fuzzy' }
  return { level: 'good', text: 'green screen looks good' }
}

// ─── hotkeys ───
export type KeyAction =
  | { type: 'capture' } | { type: 'scene'; index: number } | { type: 'sceneStep'; dir: -1 | 1 }
  | { type: 'print' } | { type: 'retake' } | { type: 'queueStep'; dir: -1 | 1 }
  | { type: 'focusSearch' } | { type: 'escape' } | { type: 'help' }

/** pure key -> action mapping. `typing` = focus is inside a text field (only Esc works then). */
export function actionForKey(key: string, captureKey: string, typing: boolean): KeyAction | null {
  if (key === 'Escape') return { type: 'escape' }
  if (typing) return null
  if (key === captureKey) return { type: 'capture' }
  if (/^[1-9]$/.test(key)) return { type: 'scene', index: Number(key) - 1 }
  switch (key) {
    case 'ArrowLeft': return { type: 'sceneStep', dir: -1 }
    case 'ArrowRight': return { type: 'sceneStep', dir: 1 }
    case 'p': case 'P': return { type: 'print' }
    case 'r': case 'R': return { type: 'retake' }
    case '[': return { type: 'queueStep', dir: -1 }
    case ']': return { type: 'queueStep', dir: 1 }
    case 'f': case 'F': return { type: 'focusSearch' }
    case '?': return { type: 'help' }
  }
  return null
}

/** human name for a key, for buttons and help ("space", "enter", "page down") */
export function keyLabel(key: string): string {
  if (key === ' ') return 'space'
  const map: Record<string, string> = { Enter: 'enter', PageDown: 'page down', PageUp: 'page up', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Tab: 'tab', Backspace: 'backspace' }
  return map[key] ?? (key.length === 1 ? key.toLowerCase() : key.toLowerCase())
}

// ─── scenes ───
export const sceneCategories = (scenes: BackgroundScene[]): string[] => [...new Set(scenes.map(s => s.category).filter(Boolean))]
export const visibleScenes = (scenes: BackgroundScene[], category: string): BackgroundScene[] =>
  category === 'all' ? scenes : scenes.filter(s => s.category === category)
/** step through a list with wrap-around; unknown current -> first */
export function stepIndex(len: number, cur: number, dir: -1 | 1): number {
  if (len <= 0) return -1
  if (cur < 0) return 0
  return (cur + dir + len) % len
}

// ─── burst / display geometry ───
export const BURST_FRAMES = 3
export const BURST_GAP_MS = 400

/** where composeScene puts the full subject frame on the canvas (mirrors core/compose geometry) */
export function subjectRect(anchor: { x: number; y: number; scale: number }, subjW: number, subjH: number, W: number, H: number) {
  const sh = Math.max(1, anchor.scale * H), sw = sh * (subjW / subjH)
  return { left: anchor.x * W - sw / 2, top: anchor.y * H - sh, w: sw, h: sh }
}

/** today's sessions that belong in the queue: not test sessions, not removed, newest first */
export function todaysSessions(list: Session[], hidden: ReadonlySet<string>, now = Date.now()): Session[] {
  return list.filter(s => !s.test && !hidden.has(s.id) && isToday(s.createdAt, now)).sort((a, b) => b.createdAt - a.createdAt)
}

export const clockLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase()
