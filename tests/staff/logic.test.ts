import { describe, it, expect } from 'vitest'
import {
  actionForKey, filterItems, formatTicket, healthFromQuality, itemStatus, keyLabel, localDay, nextTicketNumber, normalizeStaff,
  parseTicketQuery, sceneCategories, stepIndex, subjectRect, todaysSessions, visibleScenes
} from '../../src/renderer/staff/staffLogic'
import type { BackgroundScene, Session } from '../../src/shared/types'

describe('tickets', () => {
  it('formats with prefix and padding', () => {
    expect(formatTicket('A', 1)).toBe('A001'); expect(formatTicket('KB', 42)).toBe('KB042'); expect(formatTicket('A', 1234)).toBe('A1234')
  })
  it('continues the day from the highest seen number', () => {
    expect(nextTicketNumber(0, [])).toBe(1)
    expect(nextTicketNumber(5, [2, undefined, 7])).toBe(8)
    expect(nextTicketNumber(9, [2])).toBe(10)
  })
  it('parses what staff type at the exit', () => {
    expect(parseTicketQuery('a12')).toBe(12); expect(parseTicketQuery('A012')).toBe(12); expect(parseTicketQuery('12')).toBe(12); expect(parseTicketQuery('#7')).toBe(7)
    expect(parseTicketQuery('b12')).toBeNull(); expect(parseTicketQuery('smith')).toBeNull(); expect(parseTicketQuery('')).toBeNull()
    expect(parseTicketQuery('b12', 'B')).toBe(12)
  })
  it('local day key is stable', () => { expect(localDay(new Date(2026, 10, 8, 23, 59))).toBe('2026-11-08') })
  it('filters by ticket (exact + prefix) or label', () => {
    const items = [{ ticket: 1 }, { ticket: 12, label: 'Smith family' }, { ticket: 120 }, { ticket: 3, label: 'class 5b' }]
    expect(filterItems(items, '12').map(i => i.ticket)).toEqual([12, 120])
    expect(filterItems(items, 'a1').map(i => i.ticket)).toEqual([1, 12, 120])
    expect(filterItems(items, 'smith').map(i => i.ticket)).toEqual([12])
    expect(filterItems(items, '  ').length).toBe(4)
  })
})

describe('staff settings', () => {
  it('fills and clamps', () => {
    expect(normalizeStaff(undefined)).toMatchObject({ autoPrint: false, copies: 1, ticketPrefix: 'A', captureKey: ' ', countdownSec: 3 })
    const n = normalizeStaff({ copies: 99, countdownSec: -4, ticketPrefix: 'ab!cd', captureKey: '', autoPrint: true })
    expect(n).toMatchObject({ copies: 10, countdownSec: 0, ticketPrefix: 'ABC', captureKey: ' ', autoPrint: true })
  })
})

describe('status chips', () => {
  it('prioritises failure, then busy, printed, sharing', () => {
    const base = { busy: null, failed: null, printed: 0 } as const
    expect(itemStatus(base).key).toBe('ready')
    expect(itemStatus({ ...base, busy: 'processing' }).key).toBe('processing')
    expect(itemStatus({ ...base, busy: 'printing' }).key).toBe('printing')
    expect(itemStatus({ ...base, printed: 2 }).label).toBe('printed ×2')
    expect(itemStatus({ ...base, printed: 1, sharing: true }).key).toBe('printed')
    expect(itemStatus({ ...base, sharing: true }).key).toBe('uploading')
    expect(itemStatus({ ...base, busy: 'printing', failed: { stage: 'print' } })).toMatchObject({ key: 'failed-print', tone: 'bad' })
    expect(itemStatus({ ...base, failed: { stage: 'process' } }).key).toBe('failed-process')
  })
})

describe('green screen health', () => {
  it('speaks plain english', () => {
    expect(healthFromQuality({ coverage: 0.5, edgeNoise: 0.05 }).level).toBe('good')
    expect(healthFromQuality({ coverage: 0.02, edgeNoise: 0 }).text).toMatch(/can't see the green/)
    expect(healthFromQuality({ coverage: 0.95, edgeNoise: 0 }).text).toMatch(/wearing green/)
    expect(healthFromQuality({ coverage: 0.5, edgeNoise: 0.5 })).toMatchObject({ level: 'warn' })
    expect(healthFromQuality({ coverage: 0.5, edgeNoise: 0.5 }).text).toMatch(/2 steps forward/)
    expect(healthFromQuality({ coverage: 0.5, edgeNoise: 0, greenFrac: 0.05 }).text).toMatch(/green is showing/)
  })
})

describe('hotkeys', () => {
  it('maps keys', () => {
    expect(actionForKey(' ', ' ', false)).toEqual({ type: 'capture' })
    expect(actionForKey('PageDown', 'PageDown', false)).toEqual({ type: 'capture' })
    expect(actionForKey('3', ' ', false)).toEqual({ type: 'scene', index: 2 })
    expect(actionForKey('0', ' ', false)).toBeNull()
    expect(actionForKey('ArrowRight', ' ', false)).toEqual({ type: 'sceneStep', dir: 1 })
    expect(actionForKey('p', ' ', false)).toEqual({ type: 'print' }); expect(actionForKey('R', ' ', false)).toEqual({ type: 'retake' })
    expect(actionForKey('[', ' ', false)).toEqual({ type: 'queueStep', dir: -1 }); expect(actionForKey(']', ' ', false)).toEqual({ type: 'queueStep', dir: 1 })
    expect(actionForKey('f', ' ', false)).toEqual({ type: 'focusSearch' }); expect(actionForKey('?', ' ', false)).toEqual({ type: 'help' })
  })
  it('only escape works while typing', () => {
    expect(actionForKey(' ', ' ', true)).toBeNull(); expect(actionForKey('1', ' ', true)).toBeNull(); expect(actionForKey('Escape', ' ', true)).toEqual({ type: 'escape' })
  })
  it('names keys', () => { expect(keyLabel(' ')).toBe('space'); expect(keyLabel('PageDown')).toBe('page down'); expect(keyLabel('B')).toBe('b') })
})

describe('scenes and geometry', () => {
  const sc = (id: string, category: string) => ({ id, name: id, category, file: id, anchor: { x: 0.5, y: 1, scale: 0.78 }, enabled: true }) as BackgroundScene
  const scenes = [sc('a', 'space'), sc('b', 'dino'), sc('c', 'space')]
  it('categories + filter', () => {
    expect(sceneCategories(scenes)).toEqual(['space', 'dino'])
    expect(visibleScenes(scenes, 'all')).toHaveLength(3); expect(visibleScenes(scenes, 'space').map(s => s.id)).toEqual(['a', 'c'])
  })
  it('wraps stepping', () => {
    expect(stepIndex(3, 2, 1)).toBe(0); expect(stepIndex(3, 0, -1)).toBe(2); expect(stepIndex(3, -1, 1)).toBe(0); expect(stepIndex(0, 0, 1)).toBe(-1)
  })
  it('subject rect mirrors the compositor (feet on anchor.y, centred on anchor.x)', () => {
    const r = subjectRect({ x: 0.5, y: 1, scale: 0.78 }, 1920, 1080, 1200, 1800)
    expect(r.h).toBeCloseTo(1404); expect(r.top + r.h).toBeCloseTo(1800); expect(r.left + r.w / 2).toBeCloseTo(600)
  })
})

describe('todays sessions', () => {
  const now = new Date(2026, 10, 8, 12).getTime()
  const s = (id: string, t: number, extra: Partial<Session> = {}): Session => ({ id, createdAt: t, shots: [], printed: 0, ...extra })
  it('keeps today only, drops tests and removed, newest first', () => {
    const list = [s('old', now - 2 * 86400_000), s('a', now - 3600_000), s('t', now - 1000, { test: true }), s('gone', now - 500), s('b', now - 60_000)]
    expect(todaysSessions(list, new Set(['gone']), now).map(x => x.id)).toEqual(['b', 'a'])
  })
})
