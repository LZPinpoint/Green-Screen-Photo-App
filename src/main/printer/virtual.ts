import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { PrinterDevice, PrinterDriver, PrintSize } from '@shared/types'
import { jpegToPdf, prepareForPrint } from './image'
import { PRINT_INCHES } from './sizes'

export const VIRTUAL_PRINTER = 'virtual-pdf'

/** Writes PNG + PDF (exact paper size) into <printsDir>. Used when no real printer is selected and in tests. */
export class VirtualPdfPrinter implements PrinterDriver {
  constructor(private readonly printsDir: string) {}
  async list(): Promise<PrinterDevice[]> {
    return [{ name: VIRTUAL_PRINTER, displayName: 'Virtual PDF printer (saves to prints folder)', isDefault: false, status: 'ready' }]
  }
  async print(opts: { printer: string; file: string; size: PrintSize; copies: number }): Promise<{ jobId: string }> {
    const jobId = `vpdf-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`
    await mkdir(this.printsDir, { recursive: true })
    const img = await prepareForPrint(opts.file, opts.size)
    const inch = PRINT_INCHES[opts.size]
    const pdf = jpegToPdf(img.jpeg, img.width, img.height, inch.w, inch.h)
    await writeFile(join(this.printsDir, `${jobId}.png`), img.png)
    await writeFile(join(this.printsDir, `${jobId}.pdf`), pdf)
    if (opts.copies > 1) await writeFile(join(this.printsDir, `${jobId}.copies.txt`), `copies=${opts.copies}\n`)
    return { jobId }
  }
}
