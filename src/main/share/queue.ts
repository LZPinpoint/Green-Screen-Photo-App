import { EventEmitter } from 'node:events'
import * as nodeFs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ShareClient, ShareHttpError, sniffImageType } from './client'
import { newShareId, SHARE_ID_RE } from './id'

export interface QueueFs {
  readFile(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  writeText(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(dir: string): Promise<void>
}
export const nodeQueueFs: QueueFs = {
  readFile: (p) => nodeFs.readFile(p),
  readText: (p) => nodeFs.readFile(p, 'utf8'),
  writeText: (p, d) => nodeFs.writeFile(p, d),
  rename: (a, b) => nodeFs.rename(a, b),
  mkdir: async (d) => { await nodeFs.mkdir(d, { recursive: true }) },
}

export interface UploadMeta { createdAt?: number; scene?: string; layout?: string; thumbPath?: string }
export interface EmailRequest { shareId: string; email: string; consent: boolean; marketingOptIn?: boolean }

interface Job {
  id: string
  kind: 'upload' | 'email'
  shareId: string
  sessionId?: string
  filePath?: string
  meta?: UploadMeta
  email?: { email: string; consent: boolean; marketingOptIn: boolean }
  stage: 'session' | 'image' | 'thumb'
  attempts: number
  nextAttemptAt: number
  status: 'pending' | 'failed'
  lastError?: string
  createdAt: number
}
interface State { version: 1; jobs: Job[] }

export interface ShareQueueOptions {
  dir: string
  client: ShareClient
  fs?: QueueFs
  now?: () => number
  random?: () => number
  baseDelayMs?: number
  maxDelayMs?: number
  giveUpAfterMs?: number
}
export interface QueueStatus { pending: number; failed: number; total: number; busy: boolean }

export type ShareQueueEvents = {
  uploaded: [{ shareId: string; sessionId?: string; guestUrl: string }]
  'email-sent': [{ shareId: string }]
  retry: [{ jobId: string; kind: Job['kind']; attempts: number; delayMs: number; error: string }]
  failed: [{ jobId: string; kind: Job['kind']; shareId: string; error: string }]
  status: [QueueStatus]
}

/**
 * Offline-first persisted queue. Never throws into the guest flow: enqueue* are synchronous and return
 * immediately; all network work happens in the background with exponential backoff.
 */
export class ShareQueue {
  private ev = new EventEmitter()
  private fs: QueueFs
  private now: () => number
  private rand: () => number
  private base: number
  private max: number
  private giveUp: number
  private file: string
  private jobs: Job[] = []
  private started?: Promise<void>
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private stopped = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private opts: ShareQueueOptions) {
    this.fs = opts.fs ?? nodeQueueFs
    this.now = opts.now ?? (() => Date.now())
    this.rand = opts.random ?? Math.random
    this.base = opts.baseDelayMs ?? 2_000
    this.max = opts.maxDelayMs ?? 15 * 60_000
    this.giveUp = opts.giveUpAfterMs ?? 7 * 86_400_000
    this.file = join(opts.dir, 'share-queue.json')
  }

  on<K extends keyof ShareQueueEvents>(e: K, fn: (...a: ShareQueueEvents[K]) => void) { this.ev.on(e, fn as any); return this }
  off<K extends keyof ShareQueueEvents>(e: K, fn: (...a: ShareQueueEvents[K]) => void) { this.ev.off(e, fn as any); return this }
  private emit<K extends keyof ShareQueueEvents>(e: K, ...a: ShareQueueEvents[K]) {
    try { this.ev.emit(e, ...a) } catch { /* listeners must never break the queue */ }
  }

  /** Load persisted jobs and begin processing. Idempotent. */
  start(): Promise<void> {
    this.started ??= (async () => {
      let loaded: Job[] = []
      try {
        const s = JSON.parse(await this.fs.readText(this.file)) as State
        if (s?.version === 1 && Array.isArray(s.jobs)) loaded = s.jobs
      } catch { /* no file yet / corrupt: start empty */ }
      for (const j of loaded) if (j.status === 'pending') j.nextAttemptAt = 0 // fresh process: try right away
      const have = new Set(this.jobs.map((j) => j.id))
      this.jobs = [...loaded.filter((j) => !have.has(j.id)), ...this.jobs]
      this.emitStatus()
      this.schedule()
    })()
    return this.started
  }

  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer) }

  /** Resolves once state has been written to disk (useful in tests / before quit). */
  async flush() { await this.started; await this.writeChain }

  status(): QueueStatus {
    const failed = this.jobs.filter((j) => j.status === 'failed').length
    return { pending: this.jobs.length - failed, failed, total: this.jobs.length, busy: this.running }
  }

  /** Queue a composite for upload. guestUrl is final immediately: print the QR now. */
  enqueueUpload(p: { sessionId: string; filePath: string; meta?: UploadMeta; shareId?: string }): { guestUrl: string; shareId: string } {
    const existing = this.jobs.find((j) => j.kind === 'upload' && j.sessionId === p.sessionId && j.filePath === p.filePath)
    if (existing) return { guestUrl: this.opts.client.guestUrl(existing.shareId), shareId: existing.shareId }
    if (p.shareId !== undefined && !SHARE_ID_RE.test(p.shareId)) throw new Error('invalid shareId')
    const shareId = p.shareId ?? newShareId()
    this.add({ kind: 'upload', shareId, sessionId: p.sessionId, filePath: p.filePath, meta: p.meta ?? {}, stage: 'session' })
    return { guestUrl: this.opts.client.guestUrl(shareId), shareId }
  }

  /** Queue an email delivery for a shareId (returned by enqueueUpload). consent must be true. */
  enqueueEmail(p: EmailRequest): { queued: boolean } {
    if (!p.consent) return { queued: false }
    this.add({ kind: 'email', shareId: p.shareId, email: { email: p.email, consent: true, marketingOptIn: !!p.marketingOptIn }, stage: 'session' })
    return { queued: true }
  }

  /** Put permanently-failed jobs back in the queue (e.g. after fixing the API key). */
  retryFailed() {
    for (const j of this.jobs) if (j.status === 'failed') { j.status = 'pending'; j.attempts = 0; j.nextAttemptAt = 0; j.lastError = undefined }
    this.persist(); this.emitStatus(); this.schedule()
  }

  private add(j: Pick<Job, 'kind' | 'shareId' | 'stage'> & Partial<Job>) {
    const t = this.now()
    this.jobs.push({ id: newShareId(), attempts: 0, nextAttemptAt: 0, status: 'pending', createdAt: t, ...j } as Job)
    this.persist(); this.emitStatus()
    void this.start().then(() => this.schedule())
  }

  private persist() {
    const snapshot = JSON.stringify({ version: 1, jobs: this.jobs } satisfies State)
    this.writeChain = this.writeChain.then(async () => {
      try {
        await this.fs.mkdir(dirname(this.file))
        const tmp = this.file + '.tmp'
        await this.fs.writeText(tmp, snapshot)
        await this.fs.rename(tmp, this.file)
      } catch { /* disk trouble must not crash the booth; next persist retries */ }
    })
  }
  private emitStatus() { this.emit('status', this.status()) }

  private runnable(j: Job): boolean {
    if (j.status !== 'pending') return false
    if (j.kind === 'email') {
      const up = this.jobs.find((u) => u.kind === 'upload' && u.shareId === j.shareId)
      if (up) return false // wait until the photo is on the server
    }
    return true
  }

  private schedule() {
    if (this.stopped || this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const due = this.jobs.filter((j) => this.runnable(j)).map((j) => j.nextAttemptAt)
    // email jobs whose upload failed can never run: fail them
    if (!due.length) return
    const delay = Math.max(0, Math.min(...due) - this.now())
    this.timer = setTimeout(() => { void this.tick() }, delay)
    ;(this.timer as any).unref?.()
  }

  private async tick() {
    if (this.running || this.stopped) return
    this.running = true
    this.emitStatus()
    try {
      for (;;) {
        this.failOrphanEmails()
        const j = this.jobs.find((x) => this.runnable(x) && x.nextAttemptAt <= this.now())
        if (!j) break
        await this.run(j)
      }
    } finally {
      this.running = false
      this.emitStatus()
      this.schedule()
    }
  }

  private failOrphanEmails() {
    for (const j of this.jobs) {
      if (j.kind === 'email' && j.status === 'pending') {
        const up = this.jobs.find((u) => u.kind === 'upload' && u.shareId === j.shareId)
        if (up?.status === 'failed') this.fail(j, 'upload_failed')
      }
    }
  }

  private fail(j: Job, error: string) {
    j.status = 'failed'; j.lastError = error
    this.persist()
    this.emit('failed', { jobId: j.id, kind: j.kind, shareId: j.shareId, error })
  }

  private remove(j: Job) { this.jobs = this.jobs.filter((x) => x !== j); this.persist() }

  private async run(j: Job) {
    try {
      if (j.kind === 'upload') await this.runUpload(j)
      else {
        await this.opts.client.sendEmail(j.shareId, j.email!)
        this.remove(j)
        this.emit('email-sent', { shareId: j.shareId })
      }
    } catch (e) {
      const he = e instanceof ShareHttpError ? e : null
      const msg = e instanceof Error ? e.message : String(e)
      const missingFile = (e as NodeJS.ErrnoException)?.code === 'ENOENT'
      // 404 on image/email = server lost/not yet created the session: restart from stage 1
      const recoverable404 = he?.status === 404
      if (recoverable404 && j.kind === 'upload') j.stage = 'session'
      const retryable = !missingFile && (he ? he.retryable || recoverable404 : false)
      if (!retryable || this.now() - j.createdAt > this.giveUp) { this.fail(j, msg); return }
      j.attempts++
      let delay = Math.min(this.max, this.base * 2 ** (j.attempts - 1))
      delay = Math.round(delay * (1 + 0.2 * this.rand()))
      if (he?.retryAfterSec) delay = Math.max(delay, Math.min(this.max, he.retryAfterSec * 1000))
      j.nextAttemptAt = this.now() + delay
      j.lastError = msg
      this.persist()
      this.emit('retry', { jobId: j.id, kind: j.kind, attempts: j.attempts, delayMs: delay, error: msg })
    }
  }

  private async runUpload(j: Job) {
    const c = this.opts.client
    if (j.stage === 'session') {
      const r = await c.createSession({ id: j.shareId, createdAt: j.meta?.createdAt ?? j.createdAt, scene: j.meta?.scene, layout: j.meta?.layout })
      if (r.id !== j.shareId) throw new ShareHttpError(409, 'id_mismatch', 'server did not accept the proposed id')
      j.stage = 'image'; this.persist()
    }
    if (j.stage === 'image') {
      const bytes = await this.fs.readFile(j.filePath!)
      await c.uploadImage(j.shareId, bytes, sniffImageType(bytes) ?? 'image/jpeg')
      j.stage = 'thumb'; this.persist()
    }
    if (j.stage === 'thumb') {
      if (j.meta?.thumbPath) {
        let tb: Uint8Array | null = null
        try { tb = await this.fs.readFile(j.meta.thumbPath) } catch { /* thumb is optional */ }
        if (tb) await c.uploadThumb(j.shareId, tb, sniffImageType(tb) ?? 'image/jpeg')
      }
    }
    this.remove(j)
    this.emit('uploaded', { shareId: j.shareId, sessionId: j.sessionId, guestUrl: c.guestUrl(j.shareId) })
  }
}
