import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import type { PrinterDevice, PrinterDriver, PrintSize } from '@shared/types'
import { prepareForPrint } from './image'
import { MEDIA_NAME, PRINT_INCHES, printMicrons } from './sizes'

export interface HostPrinterInfo { name: string; displayName?: string; isDefault?: boolean; status?: number }
export interface PrintOptions {
  silent: true; deviceName: string; copies: number; printBackground: true
  margins: { marginType: 'none' }; pageSize: { width: number; height: number }; landscape: false
}
/** Abstraction over Electron so the printer logic is unit-testable without Electron. */
export interface PrintHost {
  getPrinters(): Promise<HostPrinterInfo[]>
  /** Load the local HTML file in a hidden window sized `inW x inH` inches and print it silently with `opts`. */
  printHtmlFile(htmlFile: string, html: string, inW: number, inH: number, opts: PrintOptions): Promise<void>
}

/** HTML for one exactly-sized page: @page margin 0, image fills page. */
export function buildPrintHtml(imageUrl: string, size: PrintSize): string {
  const { w, h } = PRINT_INCHES[size]
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${w}in ${h}in; margin: 0 }
html,body { margin:0; padding:0; width:${w}in; height:${h}in; overflow:hidden; background:#fff }
img { display:block; width:${w}in; height:${h}in; object-fit:cover }
</style></head><body><img src="${imageUrl}"></body></html>`
}

/** Electron status bit 0 on some platforms: 0 = ready. Anything else we report 'unknown' unless clearly offline/busy. */
export function mapStatus(s: number | undefined): PrinterDevice['status'] {
  if (s === undefined) return 'unknown'
  if (s === 0) return 'ready'
  if (s & 0x80) return 'offline'   // PRINTER_STATUS_OFFLINE
  if (s & 0x400) return 'busy'     // PRINTER_STATUS_PRINTING
  return 'unknown'
}

export class ElectronPrinter implements PrinterDriver {
  constructor(private readonly host: PrintHost, private readonly tmpRoot: string = tmpdir()) {}

  async list(): Promise<PrinterDevice[]> {
    const ps = await this.host.getPrinters()
    return ps.map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: mapStatus(p.status) }))
  }

  async print(opts: { printer: string; file: string; size: PrintSize; copies: number }): Promise<{ jobId: string }> {
    const jobId = `print-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`
    const dir = await mkdtemp(join(this.tmpRoot, 'booth-print-'))
    try {
      const img = await prepareForPrint(opts.file, opts.size)
      const imgFile = join(dir, 'page.png')
      await writeFile(imgFile, img.png)
      const html = buildPrintHtml(pathToFileURL(imgFile).href, opts.size)
      const htmlFile = join(dir, 'page.html')
      await writeFile(htmlFile, html)
      const { w, h } = PRINT_INCHES[opts.size]
      await this.host.printHtmlFile(htmlFile, html, w, h, {
        silent: true, deviceName: opts.printer, copies: Math.max(1, Math.floor(opts.copies)), printBackground: true,
        margins: { marginType: 'none' }, pageSize: printMicrons(opts.size), landscape: false
      })
      return { jobId }
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined) }
  }
  mediaFor(size: PrintSize): string { return MEDIA_NAME[size] }
}

/** Real Electron-backed host. Imports electron lazily so tests never load it. */
export async function createElectronPrintHost(): Promise<PrintHost> {
  const { BrowserWindow } = await import('electron')
  const hostWin = () => new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, javascript: false } })
  return {
    async getPrinters() {
      const win = hostWin()
      try { return (await win.webContents.getPrintersAsync()) as HostPrinterInfo[] } finally { win.destroy() }
    },
    async printHtmlFile(htmlFile, _html, inW, inH, opts) {
      const dpi = 96
      const win = new BrowserWindow({ show: false, useContentSize: true, width: Math.round(inW * dpi), height: Math.round(inH * dpi), webPreferences: { sandbox: true } })
      try {
        await win.loadFile(htmlFile)
        await win.webContents.executeJavaScript('Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r })))')
        await new Promise<void>((resolve, reject) => win.webContents.print(opts, (ok, reason) => ok ? resolve() : reject(new Error(`print failed: ${reason}`))))
      } finally { win.destroy() }
    }
  }
}
