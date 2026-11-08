import { describe, expect, it, vi } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { PrinterDriver, Session } from '../../src/shared/types'
import { VirtualPdfPrinter, VIRTUAL_PRINTER } from '../../src/main/printer/virtual'
import { ElectronPrinter, buildPrintHtml, mapStatus, type PrintHost } from '../../src/main/printer/electron'
import { PrintQueue, type PrintJobEvent } from '../../src/main/printer/queue'
import { printMicrons, printPixels } from '../../src/main/printer/sizes'
import { createServices, sizeFromDims } from '../../src/main/services'
import { tmp, cleanupTmp, pngDataUrl } from './helpers'
cleanupTmp()

describe('sizes', () => {
  it('exact px and microns', () => {
    expect(printPixels('4x6')).toEqual({ w: 1200, h: 1800 })
    expect(printPixels('2x6-strip')).toEqual({ w: 600, h: 1800 })
    expect(printMicrons('4x6')).toEqual({ width: 101600, height: 152400 })
    expect(printMicrons('5x7')).toEqual({ width: 127000, height: 177800 })
  })
  it('sizeFromDims picks by aspect, either orientation', () => {
    expect(sizeFromDims(1200, 1800, '5x7')).toBe('4x6')
    expect(sizeFromDims(1800, 1200, '5x7')).toBe('4x6')
    expect(sizeFromDims(1500, 2100, '4x6')).toBe('5x7')
    expect(sizeFromDims(1800, 2400, '4x6')).toBe('6x8')
    expect(sizeFromDims(600, 1800, '4x6')).toBe('2x6-strip')
    expect(sizeFromDims(1000, 1000, '5x7')).toBe('5x7')
  })
})

describe('VirtualPdfPrinter', () => {
  it('writes PNG at paper pixels and a valid PDF', async () => {
    const d = await tmp()
    const f = join(d, 'in.png'); const { writeFile } = await import('node:fs/promises')
    await writeFile(f, Buffer.from((await pngDataUrl(1800, 1200)).split(',')[1], 'base64'))
    const p = new VirtualPdfPrinter(join(d, 'prints'))
    const { jobId } = await p.print({ printer: VIRTUAL_PRINTER, file: f, size: '4x6', copies: 1 })
    const files = await readdir(join(d, 'prints'))
    expect(files.sort()).toEqual([`${jobId}.pdf`, `${jobId}.png`])
    const m = await sharp(join(d, 'prints', `${jobId}.png`)).metadata()
    expect([m.width, m.height]).toEqual([1200, 1800]) // landscape input rotated
    const pdf = (await readFile(join(d, 'prints', `${jobId}.pdf`))).toString('latin1')
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/MediaBox [0 0 288 432]')
    expect(pdf).toContain('%%EOF')
  })
})

describe('ElectronPrinter', () => {
  it('lists + builds exact-inch html and silent options', async () => {
    const d = await tmp()
    const { writeFile } = await import('node:fs/promises')
    const f = join(d, 'in.png'); await writeFile(f, Buffer.from((await pngDataUrl(1200, 1800)).split(',')[1], 'base64'))
    const printHtmlFile = vi.fn(async (_f: string, _h: string, _w: number, _i: number, _o: unknown) => undefined)
    const host: PrintHost = { getPrinters: async () => [{ name: 'DP-QW410', displayName: 'DNP QW410', isDefault: true, status: 0 }], printHtmlFile }
    const ep = new ElectronPrinter(host, d)
    expect(await ep.list()).toEqual([{ name: 'DP-QW410', displayName: 'DNP QW410', isDefault: true, status: 'ready' }])
    await ep.print({ printer: 'DP-QW410', file: f, size: '5x7', copies: 2 })
    const [, html, w, h, opts] = printHtmlFile.mock.calls[0]
    expect([w, h]).toEqual([5, 7])
    expect(html).toContain('@page { size: 5in 7in; margin: 0 }')
    expect(opts).toMatchObject({ silent: true, deviceName: 'DP-QW410', copies: 2, margins: { marginType: 'none' }, pageSize: { width: 127000, height: 177800 } })
    expect(buildPrintHtml('file:///x.png', '2x6-strip')).toContain('width:2in')
    expect(mapStatus(undefined)).toBe('unknown')
  })
})

function session(printed = 0): Session { return { id: 's1', createdAt: 1, shots: [], printed, composite: 'c.png' } }

describe('PrintQueue', () => {
  function mk(over: { realFails?: number; max?: number } = {}) {
    let s = session()
    const calls: string[] = []
    let fails = over.realFails ?? 0
    const real: PrinterDriver = {
      list: async () => [{ name: 'Real', displayName: 'Real', isDefault: true, status: 'ready' }],
      print: async o => { calls.push(`real:${o.copies}:${o.size}`); if (fails-- > 0) throw new Error('jam'); return { jobId: 'r' } }
    }
    const virtual: PrinterDriver = { list: async () => [{ name: VIRTUAL_PRINTER, displayName: 'v', isDefault: false, status: 'ready' }], print: async o => { calls.push(`virtual:${o.copies}`); return { jobId: 'v' } } }
    let printer: string | undefined = 'Real'
    const q = new PrintQueue({
      real, virtual,
      getSettings: async () => ({ printerName: printer, maxPrintsPerSession: over.max ?? 2, defaultLayoutId: 'classic-4x6' }),
      getSession: async () => s,
      addPrinted: async (_id, n) => { s = { ...s, printed: s.printed + n }; return s },
      compositePath: x => x.composite, sizeFor: async () => '4x6', retryDelayMs: 1, sleep: async () => undefined
    })
    const events: PrintJobEvent[] = []
    q.on('status', e => events.push(e))
    return { q, calls, events, get s() { return s }, setPrinter: (p?: string) => { printer = p } }
  }
  it('prints, increments printed, emits status', async () => {
    const t = mk(); await t.q.enqueue('s1', 2); await t.q.idle()
    expect(t.calls).toEqual(['real:2:4x6']); expect(t.s.printed).toBe(2)
    expect(t.events.map(e => e.status)).toEqual(['queued', 'printing', 'done'])
  })
  it('retries 3x then fails without incrementing', async () => {
    const t = mk({ realFails: 99 }); await t.q.enqueue('s1', 1); await t.q.idle()
    expect(t.calls).toHaveLength(3); expect(t.s.printed).toBe(0)
    expect(t.events.map(e => e.status)).toEqual(['queued', 'printing', 'retrying', 'retrying', 'failed'])
    expect(t.events.at(-1)!.error).toBe('jam')
  })
  it('succeeds on 3rd attempt', async () => {
    const t = mk({ realFails: 2 }); await t.q.enqueue('s1', 1); await t.q.idle()
    expect(t.events.at(-1)!.status).toBe('done'); expect(t.s.printed).toBe(1)
  })
  it('enforces maxPrintsPerSession incl. in-flight', async () => {
    const t = mk()
    await t.q.enqueue('s1', 1); await t.q.enqueue('s1', 1)
    await expect(t.q.enqueue('s1', 1)).rejects.toThrow(/limit/)
    await t.q.idle()
    await expect(t.q.enqueue('s1', 1)).rejects.toThrow(/limit/)
    await expect(t.q.enqueue('s1', 0)).rejects.toThrow()
  })
  it('falls back to virtual when no/unknown printer; lists both', async () => {
    const t = mk(); t.setPrinter(undefined)
    await t.q.enqueue('s1', 1); await t.q.idle()
    expect(t.calls).toEqual(['virtual:1'])
    expect((await t.q.listPrinters()).map(p => p.name)).toEqual(['Real', VIRTUAL_PRINTER])
  })
})

describe('services end-to-end (virtual printer)', () => {
  it('session -> composite -> print writes pdf, printed++', async () => {
    const d = await tmp()
    const sv = createServices({ dataDir: d, dslr: [], printRetryDelayMs: 1 })
    try {
      const s = await sv.sessions.start()
      await sv.sessions.saveComposite(s.id, await pngDataUrl(1200, 1800))
      await sv.printQueue.enqueue(s.id, 1); await sv.printQueue.idle()
      expect((await sv.sessions.get(s.id))!.printed).toBe(1)
      expect((await readdir(join(d, 'prints'))).some(n => n.endsWith('.pdf'))).toBe(true)
    } finally { sv.stopCleanup() }
  })
})
