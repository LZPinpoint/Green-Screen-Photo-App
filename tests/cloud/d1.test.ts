import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { D1Db, type D1Like, type D1StatementLike } from '../../cloud/src/adapters/d1'
import { runRetention } from '../../cloud/src/app'
import { DAY_MS } from '../../cloud/src/types'
import { ADMIN, JPEG, auth, createSession, makeApp, putImage, seedVenue } from './helpers'

// vite doesn't know node:sqlite as a builtin yet, so load it via require
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

/** Tiny D1 look-alike on node:sqlite so the real SQL in D1Db and schema.sql get exercised. */
function sqliteD1(): D1Like {
  const raw = new DatabaseSync(':memory:')
  raw.exec(readFileSync(new URL('../../cloud/schema.sql', import.meta.url), 'utf8'))
  const stmt = (sql: string, args: unknown[] = []): D1StatementLike => ({
    bind: (...v) => stmt(sql, v),
    first: async <T,>() => (raw.prepare(sql).get(...(args as any[])) as T | undefined) ?? null,
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(args as any[])) as T[] }),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...(args as any[])).changes) } }),
  })
  return { prepare: (sql) => stmt(sql) }
}

describe('D1Db (sql adapter)', () => {
  it('full flow: venue, session, upload, email, rate limit, csv, retention, purge', async () => {
    const app = makeApp({ db: new D1Db(sqliteD1()) })
    const v = await seedVenue(app, 'demo', { retentionDays: 7 })
    expect((await createSession(app, v)).r.status).toBe(201)
    const id = (await createSession(app, v, { id: 'A'.repeat(22) })).j.id
    expect((await createSession(app, v, { id })).r.status).toBe(200) // INSERT OR IGNORE idempotency
    expect((await putImage(app, v, id, JPEG)).status).toBe(200)
    expect((await app.ctx.db.getSession(id))).toMatchObject({ hasImage: true, imageType: 'image/jpeg', venueId: 'demo' })
    expect((await app.call('GET', `/g/${id}`)).status).toBe(200)

    const post = (email: string, marketingOptIn: boolean) =>
      app.call('POST', `/api/v1/sessions/${id}/email`, { json: { email, consent: true, marketingOptIn }, headers: { 'cf-connecting-ip': '8.8.8.8' } })
    expect((await post('yes@example.com', true)).status).toBe(200)
    expect((await (await post('yes@example.com', true)).json()).duplicate).toBe(true)
    expect((await post('no@example.com', false)).status).toBe(200)
    expect(app.email.sent).toHaveLength(2)
    const csv = await (await app.call('GET', '/api/v1/venues/demo/optins.csv', { headers: auth(ADMIN) })).text()
    expect(csv).toContain('yes@example.com'); expect(csv).not.toContain('no@example.com')

    // rate-limit window counter in SQL (3 hits so far for this session; cap is 5)
    expect((await post('c@example.com', false)).status).toBe(200)
    expect((await post('d@example.com', false)).status).toBe(200)
    expect((await post('e@example.com', false)).status).toBe(429)
    app.clock.advance(3_600_001)
    expect((await post('e@example.com', false)).status).toBe(200)

    app.clock.advance(8 * DAY_MS)
    const r = await runRetention(app.ctx)
    expect(r.sessions).toBe(2)
    expect(await app.ctx.db.getSession(id)).toBeNull()
    expect(await app.ctx.blobs.get(`${id}/image`)).toBeNull()
    expect(await app.ctx.db.listMarketingOptins('demo')).toHaveLength(1) // survives until optinRetentionDays

    const s2 = (await createSession(app, v)).j.id
    const p = await app.call('POST', '/api/v1/venues/demo/purge', { headers: auth(v.adminKey), json: { all: true } })
    expect((await p.json()).deleted).toBe(1); expect(await app.ctx.db.getSession(s2)).toBeNull()
  })
})
