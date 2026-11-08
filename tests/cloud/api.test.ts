import { describe, expect, it } from 'vitest'
import { isValidId, newId } from '../../cloud/src/id'
import { handle, runRetention } from '../../cloud/src/app'
import { DAY_MS } from '../../cloud/src/types'
import { ADMIN, JPEG, PNG, auth, createSession, makeApp, putImage, seedVenue } from './helpers'

async function setup() {
  const app = makeApp()
  const v = await seedVenue(app)
  const { j } = await createSession(app, v)
  await putImage(app, v, j.id, JPEG)
  return { app, v, id: j.id as string }
}
const deleteTokenOf = async (app: ReturnType<typeof makeApp>, id: string) =>
  /delete\?t=([0-9a-f]+)/.exec(await (await app.call('GET', `/g/${id}`)).text())![1]

describe('ids', () => {
  it('are 22-char base62 and unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
    for (const i of ids) { expect(i).toMatch(/^[0-9A-Za-z]{22}$/); expect(isValidId(i)).toBe(true) }
  })
  it('max value still fits 22 chars and zero pads', () => {
    expect(newId(() => new Uint8Array(16).fill(255))).toHaveLength(22)
    expect(newId(() => new Uint8Array(16))).toBe('0'.repeat(22))
  })
  it('rejects bad ids', () => { expect(isValidId('short')).toBe(false); expect(isValidId('x'.repeat(21) + '-')).toBe(false) })
})

describe('venues & auth', () => {
  it('only the global admin key creates venues; keys shown once', async () => {
    const app = makeApp()
    expect((await app.call('PUT', '/api/v1/venues/demo', { json: { name: 'x' } })).status).toBe(401)
    expect((await app.call('PUT', '/api/v1/venues/demo', { headers: auth('nope'), json: { name: 'x' } })).status).toBe(401)
    const v = await seedVenue(app)
    expect(v.status).toBe(201)
    expect(v.apiKey).toMatch(/^bk_/)
    const again = await (await app.call('PUT', '/api/v1/venues/demo', { headers: auth(ADMIN), json: { name: 'Renamed' } })).json()
    expect(again.apiKey).toBeUndefined()
    // keys are stored hashed
    const stored = await app.ctx.db.getVenue('demo')
    expect(JSON.stringify(stored)).not.toContain(v.apiKey)
  })
  it('rejects uploads without / with wrong key', async () => {
    const app = makeApp(); const v = await seedVenue(app)
    expect((await app.call('POST', '/api/v1/sessions', { json: { venueId: v.venueId } })).status).toBe(401)
    expect((await app.call('POST', '/api/v1/sessions', { headers: auth('bad'), json: { venueId: v.venueId } })).status).toBe(401)
    expect((await app.call('POST', '/api/v1/sessions', { headers: auth(v.adminKey), json: { venueId: v.venueId } })).status).toBe(401) // admin key != booth key
  })
  it('a venue key cannot touch another venue', async () => {
    const app = makeApp(); const a = await seedVenue(app, 'aaa'); const b = await seedVenue(app, 'bbb')
    const { j } = await createSession(app, a)
    expect((await putImage(app, b, j.id, JPEG)).status).toBe(401)
    expect((await app.call('POST', '/api/v1/sessions', { headers: auth(b.apiKey), json: { venueId: 'aaa' } })).status).toBe(401)
  })
})

describe('sessions & uploads', () => {
  it('creates with server id and upload url', async () => {
    const app = makeApp(); const v = await seedVenue(app)
    const { r, j } = await createSession(app, v)
    expect(r.status).toBe(201)
    expect(j.id).toMatch(/^[0-9A-Za-z]{22}$/)
    expect(j.uploadUrl).toBe(`https://photos.test/api/v1/sessions/${j.id}/image`)
  })
  it('accepts a client-proposed id, idempotently', async () => {
    const app = makeApp(); const v = await seedVenue(app); const id = newId()
    const a = await createSession(app, v, { id }); expect(a.r.status).toBe(201); expect(a.j.id).toBe(id)
    const b = await createSession(app, v, { id }); expect(b.r.status).toBe(200); expect(b.j.id).toBe(id)
  })
  it('rejects malformed proposed ids and ids owned by another venue', async () => {
    const app = makeApp(); const a = await seedVenue(app, 'aaa'); const b = await seedVenue(app, 'bbb'); const id = newId()
    expect((await createSession(app, a, { id: 'nope' })).r.status).toBe(400)
    expect((await createSession(app, a, { id })).r.status).toBe(201)
    expect((await createSession(app, b, { id })).r.status).toBe(409)
  })
  it('stores jpeg and png, PUT is idempotent', async () => {
    const app = makeApp(); const v = await seedVenue(app); const { j } = await createSession(app, v)
    expect((await putImage(app, v, j.id, JPEG)).status).toBe(200)
    expect((await putImage(app, v, j.id, JPEG)).status).toBe(200)
    expect((await putImage(app, v, j.id, PNG, 'image/png')).status).toBe(200)
    expect((await putImage(app, v, j.id, JPEG, 'image/jpeg', 'thumb')).status).toBe(200)
    expect((await app.ctx.db.getSession(j.id))!.hasThumb).toBe(true)
  })
  it('checks content-type, magic bytes and the 15MB cap', async () => {
    const app = makeApp(); const v = await seedVenue(app); const { j } = await createSession(app, v)
    expect((await putImage(app, v, j.id, JPEG, 'text/html')).status).toBe(415)
    expect((await putImage(app, v, j.id, new TextEncoder().encode('<script>alert(1)</script>'), 'image/jpeg')).status).toBe(415)
    expect((await putImage(app, v, j.id, PNG, 'image/jpeg')).status).toBe(415) // declared type must match bytes
    const big = new Uint8Array(15 * 1024 * 1024 + 1); big.set(JPEG)
    expect((await putImage(app, v, j.id, big)).status).toBe(413)
    const ok = new Uint8Array(15 * 1024 * 1024); ok.set(JPEG)
    expect((await putImage(app, v, j.id, ok)).status).toBe(200)
    expect((await app.ctx.db.getSession(j.id))!.imageBytes).toBe(15 * 1024 * 1024)
  })
  it('enforces the cap on streamed bodies without content-length', async () => {
    const app = makeApp(); const v = await seedVenue(app); const { j } = await createSession(app, v)
    const stream = new ReadableStream({ start(c) { c.enqueue(JPEG); c.enqueue(new Uint8Array(16 * 1024 * 1024)); c.close() } })
    const req = new Request(`https://photos.test/api/v1/sessions/${j.id}/image`, {
      method: 'PUT', headers: { ...auth(v.apiKey), 'content-type': 'image/jpeg' }, body: stream, duplex: 'half',
    } as RequestInit)
    expect(req.headers.get('content-length')).toBeNull()
    expect((await handle(app.ctx, req)).status).toBe(413)
    expect((await app.ctx.db.getSession(j.id))!.hasImage).toBe(false)
  })
  it('404 for unknown session upload', async () => {
    const app = makeApp(); const v = await seedVenue(app)
    expect((await putImage(app, v, newId(), JPEG)).status).toBe(404)
  })
})

describe('gallery', () => {
  it('serves branded html with og tags, security headers, noindex', async () => {
    const { app, id } = await setup()
    const r = await app.call('GET', `/g/${id}`)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(html).toContain(`<meta property="og:image" content="https://photos.test/g/${id}/image">`)
    expect(html).toContain('twitter:card')
    expect(html).toContain('#B80021'); expect(html).toContain('#181818')
    expect(html).toContain('science museum'); expect(html).toContain('welcome to the dino hall')
    expect(html).toContain('download full resolution'); expect(html).toContain('delete my photo'); expect(html).toContain('available until')
    for (const s of ['facebook.com', 'twitter.com/intent', 'wa.me', 'pinterest.com', 'copy link', 'native-share', 'email me']) expect(html).toContain(s)
    expect(html).toMatch(/<img[^>]+alt="your photo/)
    expect(r.headers.get('x-robots-tag')).toContain('noindex')
    expect(html).toContain('name="robots" content="noindex')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    const csp = r.headers.get('content-security-policy')!
    const nonce = /nonce-([A-Za-z0-9]+)/.exec(csp)![1]
    expect(html.match(new RegExp(`nonce="${nonce}"`, 'g'))!.length).toBe(2)
    expect(csp).not.toMatch(/unsafe-inline/)
    expect(html).not.toMatch(/<script[^>]+src=/); expect(r.headers.get('set-cookie')).toBeNull()
  })
  it('escapes venue-controlled text', async () => {
    const app = makeApp(); const v = await seedVenue(app, 'xss', { name: '<img src=x onerror=alert(1)>', welcomeText: '"><script>1</script>' })
    const { j } = await createSession(app, v); await putImage(app, v, j.id, JPEG)
    const html = await (await app.call('GET', `/g/${j.id}`)).text()
    expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script>1</script>')
  })
  it('shows a waiting page before the upload lands', async () => {
    const app = makeApp(); const v = await seedVenue(app); const { j } = await createSession(app, v)
    const html = await (await app.call('GET', `/g/${j.id}`)).text()
    expect(html).toContain('on its way'); expect(html).not.toContain('og:image')
  })
  it('404 for unknown/malformed ids, 410 after expiry', async () => {
    const { app, id } = await setup()
    expect((await app.call('GET', `/g/${newId()}`)).status).toBe(404)
    expect((await app.call('GET', '/g/short')).status).toBe(404)
    app.clock.advance(31 * DAY_MS)
    expect((await app.call('GET', `/g/${id}`)).status).toBe(410)
    expect((await app.call('GET', `/g/${id}/image`)).status).toBe(410)
  })
  it('serves image inline and download as attachment', async () => {
    const { app, id } = await setup()
    const img = await app.call('GET', `/g/${id}/image`)
    expect(img.headers.get('content-type')).toBe('image/jpeg'); expect(img.headers.get('content-disposition')).toBe('inline')
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(JPEG)
    const dl = await app.call('GET', `/g/${id}/download`)
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment; filename="imagine-[A-Za-z0-9]{8}\.jpg"$/)
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(JPEG)
  })
})

describe('email + opt-in', () => {
  const post = (app: ReturnType<typeof makeApp>, id: string, body: unknown, ip = '1.1.1.1') =>
    app.call('POST', `/api/v1/sessions/${id}/email`, { json: body, headers: { 'cf-connecting-ip': ip } })

  it('requires consent', async () => {
    const { app, id } = await setup()
    expect((await post(app, id, { email: 'a@b.co', consent: false })).status).toBe(400)
    expect((await post(app, id, { email: 'a@b.co' })).status).toBe(400)
    expect(app.email.sent).toHaveLength(0)
  })
  it('validates addresses', async () => {
    const { app, id } = await setup()
    for (const e of ['', 'nope', 'a@b', 'a b@c.de', '<x>@y.zz', 'a@b..c', 'x'.repeat(250) + '@a.bc'])
      expect((await post(app, id, { email: e, consent: true })).status, e).toBe(400)
  })
  it('sends branded plain+html email with link and unsubscribe, stores marketing opt-in', async () => {
    const { app, id } = await setup()
    const r = await post(app, id, { email: 'Guest@Example.com', consent: true, marketingOptIn: true })
    expect(r.status).toBe(200)
    const m = app.email.sent[0]
    expect(m.to).toBe('guest@example.com'); expect(m.subject).toBe('your photo from science museum')
    expect(m.text).toContain(`https://photos.test/g/${id}`); expect(m.text).toMatch(/https:\/\/photos\.test\/u\//)
    expect(m.html).toContain('#B80021'); expect(m.html).toContain('see my photo')
    expect(m.headers!['List-Unsubscribe']).toMatch(/^<https:\/\/photos\.test\/u\//)
    const rows = await app.ctx.db.listMarketingOptins('demo')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: 'guest@example.com', venueId: 'demo', sessionId: id, consentVersion: 'v1', marketingOptIn: true, consentAt: app.clock.now() })
  })
  it('does not retain plaintext email without marketing opt-in', async () => {
    const { app, id } = await setup()
    await post(app, id, { email: 'a@example.com', consent: true, marketingOptIn: false })
    expect(app.email.sent).toHaveLength(1)
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(0)
    const row = (await app.ctx.db.getOptin(id, await (await import('../../cloud/src/crypto')).hmacHex('test-signing-secret-1234', 'email:a@example.com')))!
    expect(row.email).toBeNull()
  })
  it('double submit sends once; resend allowed after cooldown', async () => {
    const { app, id } = await setup()
    await post(app, id, { email: 'a@example.com', consent: true })
    const dup = await post(app, id, { email: 'A@example.com', consent: true })
    expect((await dup.json()).duplicate).toBe(true)
    expect(app.email.sent).toHaveLength(1)
    app.clock.advance(6 * 60_000)
    await post(app, id, { email: 'a@example.com', consent: true })
    expect(app.email.sent).toHaveLength(2)
  })
  it('honeypot pretends success but sends nothing', async () => {
    const { app, id } = await setup()
    expect((await post(app, id, { email: 'a@example.com', consent: true, website: 'http://spam' })).status).toBe(200)
    expect(app.email.sent).toHaveLength(0)
  })
  it('rate limits per ip and per session, window resets', async () => {
    const { app, id } = await setup()
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await post(app, id, { email: `u${i}@example.com`, consent: true }, `9.9.9.${i}`)).status)
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]); expect(codes.slice(5)).toEqual([429, 429]) // per-session cap 5
    app.clock.advance(3_600_001)
    expect((await post(app, id, { email: 'again@example.com', consent: true }, '9.9.9.1')).status).toBe(200)
  })
  it('rate limits per ip across sessions', async () => {
    const app = makeApp(); const v = await seedVenue(app); const codes: number[] = []
    for (let i = 0; i < 12; i++) {
      const { j } = await createSession(app, v); await putImage(app, v, j.id, JPEG)
      codes.push((await post(app, j.id, { email: `p${i}@example.com`, consent: true }, '5.5.5.5')).status)
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(10); expect(codes.slice(10)).toEqual([429, 429])
  })
  it('rolls back and 502s when the provider fails', async () => {
    const { app, id } = await setup()
    app.ctx.email = { name: 'broken', send: async () => { throw new Error('boom') } }
    expect((await post(app, id, { email: 'a@example.com', consent: true, marketingOptIn: true })).status).toBe(502)
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(0)
  })
  it('accepts the no-JS form post', async () => {
    const { app, id } = await setup()
    const r = await app.call('POST', `/api/v1/sessions/${id}/email`, { headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '2.2.2.2' }, body: 'email=a%40example.com&consent=1&marketingOptIn=1' })
    expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('html')
    expect(app.email.sent).toHaveLength(1)
  })
  it('unsubscribe link needs a valid token, GET does not mutate, POST removes the address', async () => {
    const { app, id } = await setup()
    await post(app, id, { email: 'a@example.com', consent: true, marketingOptIn: true })
    const link = /https:\/\/photos\.test(\/u\/[^\s]+)/.exec(app.email.sent[0].text)![1]
    expect((await app.call('GET', link.replace(/t=.*/, 't=bad'))).status).toBe(403)
    expect((await app.call('GET', link)).status).toBe(200)
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(1)
    expect((await app.call('POST', link)).status).toBe(200)
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(0)
  })
})

describe('csv export', () => {
  it('exports marketing opt-ins only, admin key only', async () => {
    const { app, v, id } = await setup()
    const post = (email: string, marketingOptIn: boolean, ip: string) =>
      app.call('POST', `/api/v1/sessions/${id}/email`, { json: { email, consent: true, marketingOptIn }, headers: { 'cf-connecting-ip': ip } })
    await post('yes@example.com', true, '1.0.0.1'); await post('no@example.com', false, '1.0.0.2'); await post('+evil@example.com', true, '1.0.0.3')
    expect((await app.call('GET', '/api/v1/venues/demo/optins.csv')).status).toBe(401)
    expect((await app.call('GET', '/api/v1/venues/demo/optins.csv', { headers: auth(v.apiKey) })).status).toBe(401) // booth key not enough
    for (const key of [v.adminKey, ADMIN]) {
      const r = await app.call('GET', '/api/v1/venues/demo/optins.csv', { headers: auth(key) })
      expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('text/csv')
      const csv = await r.text()
      expect(csv.split('\r\n')[0]).toBe('email,venue_id,session_id,consent_version,consent_at,marketing_opt_in')
      expect(csv).toContain('yes@example.com'); expect(csv).not.toContain('no@example.com')
      expect(csv).toContain("'+evil@example.com") // formula-injection guard
      expect(csv.trim().split('\r\n')).toHaveLength(3)
    }
    const other = await seedVenue(app, 'other')
    expect((await app.call('GET', '/api/v1/venues/demo/optins.csv', { headers: auth(other.adminKey) })).status).toBe(401)
  })
})

describe('deletion, purge, retention', () => {
  it('guest delete needs the signed token and removes blobs, row, emails', async () => {
    const { app, id } = await setup()
    await app.call('POST', `/api/v1/sessions/${id}/email`, { json: { email: 'a@example.com', consent: true, marketingOptIn: true } })
    const t = await deleteTokenOf(app, id)
    expect((await app.call('DELETE', `/g/${id}`)).status).toBe(403)
    expect((await app.call('DELETE', `/g/${id}`, { headers: { 'x-delete-token': 'f'.repeat(32) } })).status).toBe(403)
    expect((await app.call('GET', `/g/${id}/delete?t=${t}`)).status).toBe(200)
    expect((await app.call('DELETE', `/g/${id}`, { headers: { 'x-delete-token': t } })).status).toBe(200)
    expect(await app.ctx.db.getSession(id)).toBeNull()
    expect(await app.ctx.blobs.get(`${id}/image`)).toBeNull()
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(0)
    expect((await app.call('GET', `/g/${id}`)).status).toBe(404)
  })
  it('no-js delete form works', async () => {
    const { app, id } = await setup(); const t = await deleteTokenOf(app, id)
    const r = await app.call('POST', `/g/${id}/delete`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${t}` })
    expect(r.status).toBe(200); expect(await app.ctx.db.getSession(id)).toBeNull()
  })
  it("a token for one photo does not delete another", async () => {
    const { app, v, id } = await setup(); const { j } = await createSession(app, v); const t = await deleteTokenOf(app, id)
    expect((await app.call('DELETE', `/g/${j.id}`, { headers: { 'x-delete-token': t } })).status).toBe(403)
  })
  it('staff purge: auth, scope required, venue scoped', async () => {
    const { app, v, id } = await setup(); const other = await seedVenue(app, 'other'); const o = await createSession(app, other)
    expect((await app.call('POST', '/api/v1/venues/demo/purge', { json: { all: true } })).status).toBe(401)
    expect((await app.call('POST', '/api/v1/venues/demo/purge', { headers: auth(v.adminKey), json: {} })).status).toBe(400)
    const r = await app.call('POST', '/api/v1/venues/demo/purge', { headers: auth(v.adminKey), json: { all: true } })
    expect((await r.json()).deleted).toBe(1)
    expect(await app.ctx.db.getSession(id)).toBeNull(); expect(await app.ctx.db.getSession(o.j.id)).not.toBeNull()
    expect(await app.ctx.blobs.get(`${id}/image`)).toBeNull()
    expect((await app.call('POST', '/api/v1/venues/demo/purge', { headers: auth(v.adminKey), json: { sessionIds: [o.j.id] } })).status).toBe(200)
    expect(await app.ctx.db.getSession(o.j.id)).not.toBeNull() // wrong venue: ignored
  })
  it('scheduled retention deletes old blobs+rows, honours venue retentionDays, keeps fresh ones', async () => {
    const app = makeApp(); const v = await seedVenue(app, 'demo', { retentionDays: 7, optinRetentionDays: 100 })
    const old = (await createSession(app, v)).j.id; await putImage(app, v, old, JPEG)
    await app.call('POST', `/api/v1/sessions/${old}/email`, { json: { email: 'm@example.com', consent: true, marketingOptIn: true }, headers: { 'cf-connecting-ip': '3.3.3.3' } })
    await app.call('POST', `/api/v1/sessions/${old}/email`, { json: { email: 'n@example.com', consent: true, marketingOptIn: false }, headers: { 'cf-connecting-ip': '3.3.3.4' } })
    app.clock.advance(5 * DAY_MS)
    const fresh = (await createSession(app, v)).j.id; await putImage(app, v, fresh, JPEG)
    expect(await runRetention(app.ctx)).toEqual({ sessions: 0, optins: 0 })
    app.clock.advance(3 * DAY_MS) // old is now 8 days, fresh is 3
    const r = await runRetention(app.ctx)
    expect(r.sessions).toBe(1)
    expect(await app.ctx.db.getSession(old)).toBeNull(); expect(await app.ctx.blobs.get(`${old}/image`)).toBeNull()
    expect(await app.ctx.db.getSession(fresh)).not.toBeNull(); expect(await app.ctx.blobs.get(`${fresh}/image`)).not.toBeNull()
    // non-marketing address gone with its photo; marketing opt-in survives until its own retention
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(1)
    app.clock.advance(100 * DAY_MS)
    await runRetention(app.ctx)
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(0)
    expect(await app.ctx.db.getSession(fresh)).toBeNull()
  })
})
