import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { shapeByDay, topScenes, niceMax, validateSettingsImport, buildReportMarkdown, buildReportJson, checklistProgress, CHECKLIST, tipsFromStats, analyzeFrame, sessionsToday, dayKey, staffToDraft, validateStaffDraft, normalizeTicketPrefix, captureKeyLabel, isReservedCaptureKey } from '../../src/renderer/admin/helpers'

describe('stats shaping', () => {
  it('zero-fills last n days oldest first', () => {
    const today = new Date(2026, 5, 10)
    const r = shapeByDay({ '2026-06-10': 4, '2026-06-08': 2 }, 4, today)
    expect(r.map(x => x.count)).toEqual([0, 2, 0, 4])
    expect(r[3].day).toBe('2026-06-10')
  })
  it('top scenes sorted and named', () => {
    const t = topScenes({ a: 1, b: 5, c: 5 }, { b: 'space' }, 2)
    expect(t.map(x => x.name)).toEqual(['c', 'space'])
    expect(t[0].count).toBe(5); expect(t).toHaveLength(2)
  })
  it('niceMax and today', () => {
    expect(niceMax(1)).toBe(4); expect(niceMax(7)).toBe(10); expect(niceMax(130)).toBe(200)
    const d = new Date(2026, 0, 2)
    expect(sessionsToday({ sessions: 9, prints: 1, byScene: {}, byDay: { [dayKey(d)]: 3 } }, d)).toBe(3)
  })
})

describe('settings import', () => {
  it('accepts exported defaults', () => {
    const r = validateSettingsImport(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
    expect(r.ok).toBe(true); expect(r.settings?.venueName).toBe('your venue')
  })
  it('rejects junk and bad values', () => {
    expect(validateSettingsImport(null).ok).toBe(false)
    expect(validateSettingsImport([]).ok).toBe(false)
    const r = validateSettingsImport({ adminPin: 'abc', brand: { accent: 'red' }, idleTimeoutSec: 'x' })
    expect(r.ok).toBe(false); expect(r.errors.length).toBe(3)
  })
  it('clamps numbers and drops unknown keys', () => {
    const r = validateSettingsImport({ idleTimeoutSec: 99999, countdownSec: 0, evil: 1, key: { similarity: 5, edgeShrink: -1, mode: 'chroma' } })
    expect(r.ok).toBe(true)
    expect(r.settings).toMatchObject({ idleTimeoutSec: 600, countdownSec: 1 })
    expect((r.settings as any).evil).toBeUndefined()
    expect(r.settings?.key).toMatchObject({ similarity: 1, edgeShrink: 0, mode: 'chroma' })
  })
  it('empty object is an error', () => { expect(validateSettingsImport({}).ok).toBe(false) })
})

describe('report generation', () => {
  const checks = { 'a-pin': 'pass', 'a-idle': 'fail' } as const
  it('progress counts', () => {
    expect(checklistProgress({ ...checks })).toMatchObject({ pass: 1, fail: 1, total: CHECKLIST.length })
  })
  it('markdown + json', () => {
    const input = { venue: 'v', when: new Date('2026-01-01T00:00:00Z'), checks: { ...checks }, notes: { 'a-idle': 'photo flashed' }, selfTest: [{ stage: 'key', ms: 12.4, ok: true }] }
    const md = buildReportMarkdown(input)
    expect(md).toContain('[x] admin pin blocks guests'); expect(md).toContain('**FAIL** — photo flashed'); expect(md).toContain('| key | 12 | ok |')
    const j = buildReportJson(input)
    expect(j.items.find(i => i.id === 'a-idle')?.result).toBe('fail'); expect(j.selfTest).toHaveLength(1)
  })
})

describe('frame tips', () => {
  const mk = (w: number, h: number, f: (x: number, y: number) => number[]) => {
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); d.set([r, g, b, 255], (y * w + x) * 4) }
    return d
  }
  it('flags uneven lighting on the dark side', () => {
    const w = 100, h = 60
    const d = mk(w, h, x => [0, x < 50 ? 60 : 200, 40])
    const q = tipsFromStats(analyzeFrame(d, w, h, [0, 177, 64]))
    expect(q.tips.join(' ')).toMatch(/add light to the left edge/)
    expect(q.score).toBeLessThan(100)
  })
  it('good on even green', () => {
    const w = 100, h = 60
    const q = tipsFromStats(analyzeFrame(mk(w, h, () => [0, 177, 64]), w, h, [0, 177, 64]))
    expect(q.label).toBe('good')
  })
})

import { validateShare, shareToDraft, draftToShare, healthMessage, shareStatusView, exportSettingsJson, mergeImportedShare, realSessions, emptyShare } from '../../src/renderer/admin/helpers'
import { pingHealth } from '../../src/renderer/admin/tabs/Sharing'

describe('sharing helpers', () => {
  const ok = { ...emptyShare(), enabled: true, baseUrl: 'https://photos.example.com/', venueId: 'franklin', apiKey: 'k' }
  it('validates', () => {
    expect(validateShare(ok).ok).toBe(true)
    expect(validateShare({ ...ok, baseUrl: 'http://photos.example.com' }).errors.baseUrl).toMatch(/https/)
    expect(validateShare({ ...ok, baseUrl: 'http://localhost:8787' }).ok).toBe(true)
    expect(validateShare({ ...ok, baseUrl: 'not a url' }).errors.baseUrl).toBeTruthy()
    expect(validateShare({ ...ok, apiKey: ' ' }).errors.apiKey).toBeTruthy()
    expect(validateShare({ ...ok, venueId: '' }).errors.venueId).toBeTruthy()
    expect(validateShare({ ...ok, retentionDays: 0 }).errors.retentionDays).toBeTruthy()
    expect(validateShare({ ...ok, retentionDays: 1.5 }).errors.retentionDays).toBeTruthy()
    expect(validateShare(emptyShare()).ok).toBe(true) // disabled and empty is fine
    expect(validateShare({ ...emptyShare(), baseUrl: 'http://evil.com' }).ok).toBe(false)
  })
  it('draft round trip normalises', () => {
    expect(draftToShare(ok)).toEqual({ enabled: true, baseUrl: 'https://photos.example.com', venueId: 'franklin', apiKey: 'k', retentionDays: 30 })
    expect(shareToDraft(undefined).retentionDays).toBe(30)
  })
  it('messages', () => {
    expect(healthMessage({ ok: false, kind: 'network' }).text).toMatch(/ignore/)
    expect(healthMessage({ ok: false, kind: 'http', status: 404 }).text).toMatch(/404/)
    expect(healthMessage({ ok: true, ms: 12 }).tone).toBe('ok')
    expect(shareStatusView({ pending: 0, failed: 2, total: 5 }).tone).toBe('bad')
    expect(shareStatusView({ pending: 3, failed: 0, total: 5 }).tone).toBe('warn')
    expect(shareStatusView({ pending: 0, failed: 0, total: 5 }).tone).toBe('ok')
    expect(shareStatusView(undefined, false).tone).toBe('idle')
  })
  it('pingHealth', async () => {
    let url = ''
    const f = (async (u: string) => { url = u; return { ok: true, status: 200 } }) as any
    expect((await pingHealth('https://x.dev/', f)).ok).toBe(true); expect(url).toBe('https://x.dev/healthz')
    expect(await pingHealth('https://x.dev', (async () => { throw new TypeError('x') }) as any)).toEqual({ ok: false, kind: 'network' })
    expect(await pingHealth('https://x.dev', (async () => ({ ok: false, status: 503 })) as any)).toEqual({ ok: false, kind: 'http', status: 503 })
  })
  it('export strips apiKey; import never carries it', () => {
    const s = { ...DEFAULT_SETTINGS, share: { enabled: true, baseUrl: 'https://a.dev', venueId: 'v', apiKey: 'SECRET', retentionDays: 10 } }
    const json = exportSettingsJson(s)
    expect(json).not.toContain('SECRET'); expect(JSON.parse(json).share.venueId).toBe('v')
    const r = validateSettingsImport(JSON.parse(json))
    expect(r.ok).toBe(true); expect((r.settings!.share as any).apiKey).toBeUndefined()
    const m = mergeImportedShare(undefined, r.settings!.share!)
    expect(m.enabled).toBe(false); expect(m.apiKey).toBe('')
    expect(mergeImportedShare(s.share, r.settings!.share!)).toMatchObject({ enabled: true, apiKey: 'SECRET' })
    expect(validateSettingsImport({ share: { baseUrl: 'http://evil.com' } }).ok).toBe(false)
  })
  it('hides test sessions', () => {
    expect(realSessions([{ id: 'a', test: true } as any, { id: 'b' } as any]).map(s => s.id)).toEqual(['b'])
  })
})

describe('operating mode / staff options', () => {
  it('defaults round-trip and validate', () => {
    const d = staffToDraft(DEFAULT_SETTINGS)
    expect(d).toMatchObject({ mode: 'staff', autoPrint: false, copies: 1, ticketPrefix: 'A', captureKey: ' ', countdownSec: 3 })
    const v = validateStaffDraft(d)
    expect(v.ok).toBe(true); expect(v.staff).toEqual({ autoPrint: false, copies: 1, ticketPrefix: 'A', captureKey: ' ', countdownSec: 3 })
  })
  it('old settings without staff fall back to defaults', () => {
    expect(staffToDraft({} as never).mode).toBe('staff')
    expect(staffToDraft({ mode: 'kiosk' } as never)).toMatchObject({ mode: 'kiosk', copies: 1 })
  })
  it('rejects bad numbers, prefix and keys', () => {
    const base = staffToDraft(DEFAULT_SETTINGS)
    expect(validateStaffDraft({ ...base, copies: 0 }).errors.copies).toBeTruthy()
    expect(validateStaffDraft({ ...base, copies: 11 }).ok).toBe(false)
    expect(validateStaffDraft({ ...base, copies: '' }).ok).toBe(false)
    expect(validateStaffDraft({ ...base, copies: 1.5 }).ok).toBe(false)
    expect(validateStaffDraft({ ...base, countdownSec: -1 }).errors.countdownSec).toBeTruthy()
    expect(validateStaffDraft({ ...base, countdownSec: 0 }).ok).toBe(true)
    expect(validateStaffDraft({ ...base, ticketPrefix: '' }).errors.ticketPrefix).toBeTruthy()
    expect(validateStaffDraft({ ...base, ticketPrefix: 'ABCD' }).errors.ticketPrefix).toBeTruthy()
    expect(validateStaffDraft({ ...base, captureKey: '' }).errors.captureKey).toBeTruthy()
    expect(validateStaffDraft({ ...base, captureKey: 'p' }).errors.captureKey).toMatch(/already used/)
    expect(validateStaffDraft({ ...base, captureKey: 'PageDown' }).ok).toBe(true)
  })
  it('uppercases the prefix and keeps the mode', () => {
    expect(normalizeTicketPrefix('a-b!c9')).toBe('ABC')
    const v = validateStaffDraft({ ...staffToDraft(DEFAULT_SETTINGS), mode: 'kiosk', ticketPrefix: 'k' })
    expect(v.mode).toBe('kiosk'); expect(v.staff?.ticketPrefix).toBe('K')
  })
  it('names keys for people', () => {
    expect(captureKeyLabel(' ')).toBe('space'); expect(captureKeyLabel('Enter')).toBe('enter'); expect(captureKeyLabel('B')).toBe('b')
    expect(isReservedCaptureKey('Escape')).toBe(true); expect(isReservedCaptureKey('5')).toBe(true); expect(isReservedCaptureKey('b')).toBe(false)
  })
  it('settings import understands mode + staff', () => {
    const r = validateSettingsImport({ mode: 'kiosk', staff: { autoPrint: true, copies: 2, ticketPrefix: 'z', captureKey: 'Enter', countdownSec: 0 } })
    expect(r.ok).toBe(true); expect(r.settings?.mode).toBe('kiosk'); expect(r.settings?.staff).toMatchObject({ autoPrint: true, copies: 2, ticketPrefix: 'Z', captureKey: 'Enter', countdownSec: 0 })
    expect(validateSettingsImport({ mode: 'party' }).ok).toBe(false)
    expect(validateSettingsImport({ staff: { copies: 99 } }).ok).toBe(false)
  })
})
