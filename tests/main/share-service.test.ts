import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/store/settings'
import { SessionStore } from '../../src/main/store/sessions'
import { LibraryStore } from '../../src/main/store/library'
import { ShareService } from '../../src/main/shareService'
import { backend } from '../share/helpers'
import { tmp, cleanupTmp, pngDataUrl } from './helpers'
cleanupTmp()

async function setup(shareOn = true) {
  const dataDir = await tmp()
  const b = await backend()
  const settings = new SettingsStore(dataDir)
  const sessions = new SessionStore(dataDir)
  if (shareOn) await settings.set({ share: { enabled: true, baseUrl: b.baseUrl, venueId: b.venue.venueId, apiKey: b.venue.apiKey } })
  const svc = new ShareService({ dataDir, settings, sessions, fetchImpl: b.fetchImpl })
  await svc.start()
  return { dataDir, b, settings, sessions, svc }
}
const until = async (fn: () => boolean, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 25)) } }

describe('ShareService', () => {
  it('is off (and a no-op) when not configured', async () => {
    const { svc, sessions } = await setup(false)
    expect(await svc.enabled()).toBe(false)
    expect(await svc.reserve('x')).toBeNull()
    const s = await sessions.start()
    await sessions.saveComposite(s.id, await pngDataUrl())
    await svc.onComposite((await sessions.get(s.id))!) // must not throw
    expect(svc.status().total).toBe(0)
    await svc.stop()
  })

  it('reserves a stable guest link, uploads on composite, gallery serves the photo', async () => {
    const { svc, sessions, b } = await setup()
    const s = await sessions.start()
    const r1 = await svc.reserve(s.id), r2 = await svc.reserve(s.id)
    expect(r1).toEqual(r2)
    expect(r1!.guestUrl).toBe(`${b.baseUrl}/g/${r1!.shareId}`)
    expect(r1!.shareId).toMatch(/^[0-9A-Za-z]{22}$/)

    const withComposite = await sessions.saveComposite(s.id, await pngDataUrl(300, 450))
    await svc.onComposite(withComposite)
    await until(() => b.calls.some(c => c.path.endsWith('/image') && c.status === 200))
    const page = await b.fetchImpl(r1!.guestUrl)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('og:image')
    await svc.stop()
  })

  it('does not upload sessions that never reserved a link', async () => {
    const { svc, sessions, b } = await setup()
    const s = await sessions.start()
    await svc.onComposite(await sessions.saveComposite(s.id, await pngDataUrl()))
    await new Promise(r => setTimeout(r, 100))
    expect(b.calls.length).toBe(0)
    await svc.stop()
  })

  it('email needs consent, queues, and survives offline', async () => {
    const { svc, sessions, b } = await setup()
    const s = await sessions.start()
    const r = (await svc.reserve(s.id))!
    await expect(svc.email(r.shareId, 'a@b.co', false, false)).rejects.toThrow(/consent/)
    b.state.online = false
    await svc.onComposite(await sessions.saveComposite(s.id, await pngDataUrl()))
    expect((await svc.email(r.shareId, 'a@b.co', true, true)).queued).toBe(true)
    expect((await sessions.get(s.id))!.emailed).toBe('a@b.co')
    await new Promise(r => setTimeout(r, 100))
    expect(svc.status().pending).toBeGreaterThan(0) // still queued, guest was never blocked
    await svc.stop()
  })

  it('without marketing opt-in the address is not stored on the session', async () => {
    const { svc, sessions } = await setup()
    const s = await sessions.start()
    const r = (await svc.reserve(s.id))!
    await svc.email(r.shareId, 'private@x.org', true, false)
    expect((await sessions.get(s.id))!.emailed).toBe('yes')
    await svc.stop()
  })
})

describe('library frames/layouts + test sessions', () => {
  it('saveLayout upserts and validates; saveFrame toggles and rejects bad ids', async () => {
    const lib = new LibraryStore(await tmp(), [])
    const l = (await lib.layouts())[0]
    await lib.saveLayout({ ...l, footerText: 'hello', qrCode: true })
    expect((await lib.layouts()).find(x => x.id === l.id)!.footerText).toBe('hello')
    await lib.saveLayout({ ...l, id: 'custom-1', name: 'custom' })
    expect((await lib.layouts()).some(x => x.id === 'custom-1')).toBe(true)
    await expect(lib.saveLayout({ ...l, id: '../x' })).rejects.toThrow()
    await expect(lib.saveLayout({ ...l, id: 'ok', photosPerSheet: 9 as never })).rejects.toThrow()
    const f = (await lib.frames())[0]
    await lib.saveFrame({ ...f, enabled: false })
    expect((await lib.frames())[0].enabled).toBe(false)
    await expect(lib.saveFrame({ ...f, id: 'a/b' })).rejects.toThrow()
  })

  it('test sessions are excluded from stats', async () => {
    const sessions = new SessionStore(await tmp())
    const a = await sessions.start(), t = await sessions.start()
    await sessions.patch(t.id, { test: true })
    const st = await sessions.stats()
    expect(st.sessions).toBe(1)
    expect(a.id).not.toBe(t.id)
  })
})

describe('staff ticket + label persistence', () => {
  it('session.patch keeps ticket and label (trimmed) across reloads', async () => {
    const dir = await tmp()
    const s1 = new SessionStore(dir)
    const s = await s1.start()
    await s1.patch(s.id, { ticket: 12, label: 'smith family '.repeat(20) })
    const again = (await new SessionStore(dir).get(s.id))!
    expect(again.ticket).toBe(12)
    expect(again.label!.length).toBe(80)
  })
})
