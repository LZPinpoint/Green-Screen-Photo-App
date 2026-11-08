import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startDevServer, type DevServer } from '../../cloud/dev-server'
import { LogEmailProvider } from '../../cloud/src/email/providers'
import { ShareClient, ShareQueue } from '../../src/main/share'

let dev: DevServer, dir: string, file: string
const body = new Uint8Array(40_000).map((_, i) => (i * 31) & 255)
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...body, 0xff, 0xd9])

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'imagine-e2e-'))
  file = join(dir, 'composite.jpg'); writeFileSync(file, JPEG)
  dev = await startDevServer({ port: 0, dataDir: join(dir, 'server'), quiet: true })
})
afterAll(async () => { await dev.close(); rmSync(dir, { recursive: true, force: true }) })

const until = async (fn: () => boolean, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) } }

describe('end to end: ShareQueue -> dev server', () => {
  it('uploads, serves gallery with og:image, download works, email is logged, csv exports opt-in', async () => {
    const client = new ShareClient({ baseUrl: dev.url, venueId: dev.demo.venueId, apiKey: dev.demo.apiKey })
    const q = new ShareQueue({ dir: join(dir, 'queue'), client })
    const uploaded = new Promise<any>((r) => q.on('uploaded', r))
    const { guestUrl, shareId } = q.enqueueUpload({ sessionId: 'booth-1', filePath: file, meta: { scene: 'dinosaur hall', layout: 'classic-4x6', createdAt: Date.now() } })
    expect(guestUrl).toBe(`${dev.url}/g/${shareId}`)
    expect((await uploaded).guestUrl).toBe(guestUrl)

    const page = await fetch(guestUrl)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    const html = await page.text()
    expect(html).toContain(`og:image" content="${dev.url}/g/${shareId}/image"`)
    expect(html).toContain('museum of imagination')

    const dl = await fetch(`${guestUrl}/download`)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(JPEG)

    q.enqueueEmail({ shareId, email: 'guest@example.com', consent: true, marketingOptIn: true })
    const log = dev.email as LogEmailProvider
    await until(() => log.sent.length === 1)
    expect(log.sent[0]).toMatchObject({ to: 'guest@example.com' })
    expect(log.sent[0].text).toContain(guestUrl)
    await until(() => q.status().total === 0)

    const csv = await fetch(`${dev.url}/api/v1/venues/demo/optins.csv`, { headers: { authorization: `Bearer ${dev.demo.adminKey}` } })
    expect(await csv.text()).toContain('guest@example.com')

    // guest deletes via the signed link in the page
    const del = /href="(\/g\/[^"]+\/delete\?t=[0-9a-f]+)"/.exec(html)![1]
    const token = /t=([0-9a-f]+)/.exec(del)![1]
    expect((await fetch(`${dev.url}/g/${shareId}`, { method: 'DELETE', headers: { 'x-delete-token': token } })).status).toBe(200)
    expect((await fetch(guestUrl)).status).toBe(404)
    q.stop()
  })

  it('rejects a booth with a bad key without crashing the queue (marks failed)', async () => {
    const q = new ShareQueue({ dir: join(dir, 'queue2'), client: new ShareClient({ baseUrl: dev.url, venueId: 'demo', apiKey: 'bad' }) })
    q.enqueueUpload({ sessionId: 'x', filePath: file })
    await until(() => q.status().failed === 1)
    q.stop()
  })
})
