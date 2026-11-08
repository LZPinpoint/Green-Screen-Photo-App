import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareClient, ShareHttpError, ShareQueue, newShareId, sniffImageType } from '../../src/main/share'
import { JPEG, backend, memFs } from './helpers'

const FILE = '/data/composite.jpg'
const realSetTimeout = globalThis.setTimeout
const realWait = (ms = 8) => new Promise<void>((r) => realSetTimeout(r, ms))
// Only timers + Date are faked; handlers use WebCrypto, which completes on the real event loop, so we also yield real time.
beforeEach(() => { vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

async function rig(opts: { files?: Record<string, any>; apiKey?: string } = {}) {
  const b = await backend()
  const fsx = memFs({ [FILE]: JPEG, ...(opts.files ?? {}) })
  const cfg = { baseUrl: b.baseUrl, venueId: 'demo', apiKey: opts.apiKey ?? b.venue.apiKey }
  const client = new ShareClient(() => cfg, b.fetchImpl)
  const mk = () => new ShareQueue({ dir: '/q', client, fs: fsx.fs, random: () => 0, baseDelayMs: 1000, maxDelayMs: 8000 })
  return { b, fsx, cfg, client, mk }
}
async function settle(ms = 0) {
  await realWait()
  let left = ms
  do { const step = Math.min(left, 250); await vi.advanceTimersByTimeAsync(step); await realWait(); left -= step } while (left > 0)
}

describe('ShareQueue', () => {
  it('returns the guest url immediately, with a client-generated 128-bit id that the server then honours', async () => {
    const { b, mk } = await rig(); const q = mk()
    const t0 = Date.now()
    const { guestUrl, shareId } = q.enqueueUpload({ sessionId: 's1', filePath: FILE, meta: { scene: 'dino' } })
    expect(guestUrl).toBe(`https://photos.test/g/${shareId}`)
    expect(shareId).toMatch(/^[0-9A-Za-z]{22}$/)
    expect(b.calls).toHaveLength(0) // nothing sent yet: url exists before upload
    const done = new Promise<any>((r) => q.on('uploaded', r))
    await settle(10)
    expect(await done).toMatchObject({ shareId, sessionId: 's1', guestUrl })
    expect(b.calls.map((c) => `${c.method} ${c.path} ${c.status}`)).toEqual(['POST /api/v1/sessions 201', `PUT /api/v1/sessions/${shareId}/image 200`])
    expect(JSON.parse(b.calls[0].body).id).toBe(shareId)
    expect((await b.app.call('GET', `/g/${shareId}`)).status).toBe(200)
    expect(q.status()).toMatchObject({ pending: 0, failed: 0, total: 0 })
    expect(Date.now() - t0).toBeLessThan(100)
  })

  it('is idempotent per session+file', async () => {
    const { mk } = await rig(); const q = mk()
    const a = q.enqueueUpload({ sessionId: 's1', filePath: FILE }); const b = q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    expect(b.shareId).toBe(a.shareId); expect(q.status().total).toBe(1)
  })

  it('retries with exponential backoff (1s,2s,4s,8s,8s cap) then succeeds', async () => {
    const { b, mk } = await rig(); const q = mk()
    b.state.online = false
    const delays: number[] = []
    q.on('retry', (r) => delays.push(r.delayMs))
    q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    await settle(1)
    for (const d of [1000, 2000, 4000, 8000, 8000]) await settle(d)
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000])
    expect(q.status()).toMatchObject({ pending: 1, failed: 0 })
    b.state.online = true
    const up = new Promise((r) => q.on('uploaded', r))
    await settle(8000); await up
    expect(q.status().total).toBe(0)
  })

  it('retries on 5xx and 429 (honouring retry-after), but not before the delay elapsed', async () => {
    const { b, mk } = await rig(); const q = mk()
    b.state.failNext = [503]
    q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    await settle(1)
    expect(b.calls).toHaveLength(1)
    await settle(900); expect(b.calls).toHaveLength(1)
    await settle(200); expect(b.calls.length).toBeGreaterThan(1)
  })

  it('persists state with atomic tmp+rename writes and resumes after a restart with the same url', async () => {
    const { b, fsx, mk } = await rig()
    b.state.online = false
    const q1 = mk()
    const { guestUrl, shareId } = q1.enqueueUpload({ sessionId: 's1', filePath: FILE, meta: { scene: 'dino' } })
    await settle(1); await q1.flush()
    q1.stop() // app quits
    expect(fsx.log.filter((l) => l.startsWith('rename')).every((l) => l === 'rename /q/share-queue.json.tmp /q/share-queue.json')).toBe(true)
    expect(fsx.log.findIndex((l) => l.startsWith('write'))).toBeLessThan(fsx.log.findIndex((l) => l.startsWith('rename')))
    const saved = JSON.parse(fsx.m.get('/q/share-queue.json') as string)
    expect(saved.jobs).toHaveLength(1); expect(saved.jobs[0].shareId).toBe(shareId)
    expect(fsx.m.has('/q/share-queue.json.tmp')).toBe(false)

    b.state.online = true
    const q2 = mk(); // fresh process
    const up = new Promise<any>((r) => q2.on('uploaded', r))
    await q2.start(); await settle(5)
    expect((await up).guestUrl).toBe(guestUrl)
    expect((await b.app.call('GET', `/g/${shareId}`)).status).toBe(200)
    await q2.flush()
    expect(JSON.parse(fsx.m.get('/q/share-queue.json') as string).jobs).toHaveLength(0)
  })

  it('stage is saved: if image upload fails after session creation, retry does not need a new session id', async () => {
    const { b, fsx, mk } = await rig()
    let n = 0
    const realFetch = b.fetchImpl
    const client = new ShareClient({ baseUrl: b.baseUrl, venueId: 'demo', apiKey: b.venue.apiKey }, async (u, i) => { if (++n === 2) throw new TypeError('offline'); return realFetch(u, i) })
    const q = new ShareQueue({ dir: '/q', client, fs: fsx.fs, random: () => 0, baseDelayMs: 1000 })
    q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    await settle(1); await q.flush()
    const j = JSON.parse(fsx.m.get('/q/share-queue.json') as string).jobs[0]
    expect(j.stage).toBe('image'); expect(j.attempts).toBe(1)
    await settle(1000)
    expect(q.status().total).toBe(0)
    expect(b.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('permanent errors (401) fail fast; retryFailed() after fixing the key recovers', async () => {
    const { b, cfg, mk } = await rig({ apiKey: 'bk_wrong' }); const q = mk()
    const failed: any[] = []; q.on('failed', (f) => failed.push(f))
    q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    await settle(1)
    expect(failed).toHaveLength(1); expect(failed[0].error).toMatch(/unauthorized|401/)
    expect(q.status()).toMatchObject({ pending: 0, failed: 1, total: 1 })
    await settle(60_000); expect(b.calls).toHaveLength(1) // no hammering
    cfg.apiKey = b.venue.apiKey
    q.retryFailed(); await settle(5)
    expect(q.status().total).toBe(0)
  })

  it('missing file fails instead of retrying forever', async () => {
    const { mk } = await rig(); const q = mk(); const failed: any[] = []; q.on('failed', (f) => failed.push(f))
    q.enqueueUpload({ sessionId: 's1', filePath: '/nope.jpg' })
    await settle(5)
    expect(failed).toHaveLength(1); expect(q.status().failed).toBe(1)
  })

  it('gives up after giveUpAfterMs', async () => {
    const { b, fsx, client } = await rig()
    const q = new ShareQueue({ dir: '/q', client, fs: fsx.fs, random: () => 0, baseDelayMs: 1000, maxDelayMs: 1000, giveUpAfterMs: 5000 })
    b.state.online = false
    q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    await settle(10_000)
    expect(q.status().failed).toBe(1)
  })

  it('email waits for the upload, is sent once, and consent is required', async () => {
    const { b, mk } = await rig(); const q = mk()
    b.state.online = false
    const { shareId } = q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    expect(q.enqueueEmail({ shareId, email: 'a@example.com', consent: false })).toEqual({ queued: false })
    expect(q.enqueueEmail({ shareId, email: 'a@example.com', consent: true, marketingOptIn: true })).toEqual({ queued: true })
    await settle(1); b.state.online = true
    const sent = new Promise((r) => q.on('email-sent', r))
    await settle(1000); await sent
    expect(b.app.email.sent).toHaveLength(1)
    expect(b.app.email.sent[0].text).toContain(shareId)
    expect(b.calls.findIndex((c) => c.path.endsWith('/email'))).toBeGreaterThan(b.calls.findIndex((c) => c.path.endsWith('/image') && c.status === 200))
    expect(await b.app.ctx.db.listMarketingOptins('demo')).toHaveLength(1)
  })

  it('email jobs fail if their upload failed permanently', async () => {
    const { mk } = await rig({ apiKey: 'bad' }); const q = mk()
    const { shareId } = q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    q.enqueueEmail({ shareId, email: 'a@example.com', consent: true })
    await settle(10)
    expect(q.status().failed).toBe(2)
  })

  it('a throwing event listener never breaks the queue', async () => {
    const { mk } = await rig(); const q = mk()
    q.on('uploaded', () => { throw new Error('ui bug') })
    q.enqueueUpload({ sessionId: 's1', filePath: FILE })
    await settle(10); expect(q.status().total).toBe(0)
  })

  it('survives a corrupt state file', async () => {
    const { fsx, mk } = await rig({ files: { '/q/share-queue.json': '{not json' } }); const q = mk()
    await q.start(); expect(q.status().total).toBe(0)
    q.enqueueUpload({ sessionId: 's1', filePath: FILE }); await settle(10); expect(q.status().total).toBe(0); void fsx
  })
})

describe('ShareClient & ids', () => {
  it('ids are unique 22-char base62', () => {
    const s = new Set(Array.from({ length: 300 }, () => newShareId())); expect(s.size).toBe(300)
    for (const i of s) expect(i).toMatch(/^[0-9A-Za-z]{22}$/)
  })
  it('sniffs image type', () => { expect(sniffImageType(JPEG)).toBe('image/jpeg'); expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull() })
  it('maps http failures to retryable/permanent errors', async () => {
    const mk = (status: number) => new ShareClient({ baseUrl: 'https://x/', venueId: 'v', apiKey: 'k' }, async () => new Response(JSON.stringify({ error: 'nope' }), { status, headers: { 'retry-after': '7' } }) as any)
    for (const [s, r] of [[500, true], [503, true], [429, true], [408, true], [400, false], [401, false], [413, false], [415, false]] as const) {
      const e = await mk(s).createSession({ createdAt: 1 }).catch((x) => x)
      expect(e).toBeInstanceOf(ShareHttpError); expect(e.retryable, String(s)).toBe(r); expect(e.code).toBe('nope')
    }
    expect((await mk(429).createSession({ createdAt: 1 }).catch((x) => x)).retryAfterSec).toBe(7)
  })
  it('sends bearer key + json body; email endpoint is unauthenticated', async () => {
    const seen: any[] = []
    const c = new ShareClient({ baseUrl: 'https://x', venueId: 'v', apiKey: 'sekret' }, async (u, i) => { seen.push([u, i]); return new Response('{"id":"a"}') as any })
    await c.createSession({ id: 'a', createdAt: 5, scene: 's' })
    await c.sendEmail('a', { email: 'e@x.co', consent: true, marketingOptIn: false })
    expect(seen[0][0]).toBe('https://x/api/v1/sessions'); expect(seen[0][1].headers.authorization).toBe('Bearer sekret')
    expect(JSON.parse(seen[0][1].body)).toMatchObject({ venueId: 'v', id: 'a', createdAt: 5 })
    expect(seen[1][1].headers.authorization).toBeUndefined()
  })
  it('network failures are status 0 and retryable', async () => {
    const c = new ShareClient({ baseUrl: 'https://x', venueId: 'v', apiKey: 'k' }, async () => { throw new TypeError('down') })
    const e = await c.createSession({ createdAt: 1 }).catch((x) => x); expect(e.status).toBe(0); expect(e.retryable).toBe(true)
  })
})
