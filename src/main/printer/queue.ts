import { EventEmitter } from 'node:events'
import type { PrinterDevice, PrinterDriver, PrintSize, Session } from '@shared/types'
import { VIRTUAL_PRINTER } from './virtual'
import { sleep } from '../util'

export type PrintStatus = 'queued' | 'printing' | 'retrying' | 'done' | 'failed'
export interface PrintJobEvent { jobId: string; sessionId: string; status: PrintStatus; attempt: number; error?: string; copies: number }

export interface PrintQueueDeps {
  /** Real printer driver (ElectronPrinter). May be undefined in headless/tests. */
  real?: PrinterDriver
  virtual: PrinterDriver
  getSettings(): Promise<{ printerName?: string; maxPrintsPerSession: number; defaultLayoutId: string }>
  getSession(id: string): Promise<Session | undefined>
  /** Atomically add `n` to Session.printed. */
  addPrinted(id: string, n: number): Promise<Session>
  /** Absolute path of the image to print for a session. */
  compositePath(s: Session): string | undefined
  /** Paper size for the session's layout. */
  sizeFor(s: Session): Promise<PrintSize>
  maxAttempts?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

interface Job { jobId: string; sessionId: string; copies: number }

export class PrintQueue extends EventEmitter {
  private jobs: Job[] = []
  private running = false
  private seq = 0
  private idleResolvers: (() => void)[] = []
  private reserved = new Map<string, number>() // sessionId -> copies queued/in flight, counted against the cap
  constructor(private readonly d: PrintQueueDeps) { super() }

  /** Union of real printers and the virtual PDF printer. */
  async listPrinters(): Promise<PrinterDevice[]> {
    let real: PrinterDevice[] = []
    try { real = (await this.d.real?.list()) ?? [] } catch { real = [] }
    return [...real, ...(await this.d.virtual.list())]
  }

  /** Validates, enforces maxPrintsPerSession, queues, returns immediately with the jobId. Status flows via 'status' events. */
  async enqueue(sessionId: string, copies: number): Promise<{ jobId: string }> {
    const n = Math.floor(copies)
    if (!(n >= 1)) throw new Error('copies must be >= 1')
    const s = await this.d.getSession(sessionId)
    if (!s) throw new Error(`session ${sessionId} not found`)
    if (!this.d.compositePath(s)) throw new Error('session has no composite image to print')
    const { maxPrintsPerSession } = await this.d.getSettings()
    const used = s.printed + (this.reserved.get(sessionId) ?? 0)
    if (used + n > maxPrintsPerSession) throw new Error(`print limit reached (${maxPrintsPerSession} per session)`)
    this.reserved.set(sessionId, (this.reserved.get(sessionId) ?? 0) + n)
    const jobId = `job-${Date.now().toString(36)}-${++this.seq}`
    this.jobs.push({ jobId, sessionId, copies: n })
    this.emitStatus({ jobId, sessionId, status: 'queued', attempt: 0, copies: n })
    void this.pump()
    return { jobId }
  }

  /** Resolves when all queued jobs have finished (for tests / shutdown). */
  idle(): Promise<void> { return !this.running && !this.jobs.length ? Promise.resolve() : new Promise(r => this.idleResolvers.push(r)) }

  private emitStatus(e: PrintJobEvent): void { this.emit('status', e) }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let j = this.jobs.shift(); j; j = this.jobs.shift()) {
        try { await this.run(j) } finally {
          const left = (this.reserved.get(j.sessionId) ?? 0) - j.copies
          if (left > 0) this.reserved.set(j.sessionId, left); else this.reserved.delete(j.sessionId)
        }
      }
    } finally {
      this.running = false
      this.idleResolvers.splice(0).forEach(r => r())
    }
  }

  private async pickDriver(): Promise<{ driver: PrinterDriver; printer: string }> {
    const { printerName } = await this.d.getSettings()
    if (printerName && printerName !== VIRTUAL_PRINTER && this.d.real) {
      try { if ((await this.d.real.list()).some(p => p.name === printerName)) return { driver: this.d.real, printer: printerName } } catch { /* fall through */ }
    }
    return { driver: this.d.virtual, printer: VIRTUAL_PRINTER }
  }

  private async run(job: Job): Promise<void> {
    const max = this.d.maxAttempts ?? 3
    const wait = this.d.sleep ?? sleep
    let lastErr = ''
    for (let attempt = 1; attempt <= max; attempt++) {
      this.emitStatus({ ...job, status: attempt === 1 ? 'printing' : 'retrying', attempt, copies: job.copies, ...(lastErr ? { error: lastErr } : {}) })
      try {
        const s = await this.d.getSession(job.sessionId)
        const file = s && this.d.compositePath(s)
        if (!s || !file) throw new Error('composite image missing')
        const size = await this.d.sizeFor(s)
        const { driver, printer } = await this.pickDriver()
        await driver.print({ printer, file, size, copies: job.copies })
        await this.d.addPrinted(job.sessionId, job.copies)
        this.emitStatus({ ...job, status: 'done', attempt, copies: job.copies })
        return
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
        if (attempt < max) await wait((this.d.retryDelayMs ?? 2000) * attempt)
      }
    }
    this.emitStatus({ ...job, status: 'failed', attempt: max, error: lastErr, copies: job.copies })
  }
}
