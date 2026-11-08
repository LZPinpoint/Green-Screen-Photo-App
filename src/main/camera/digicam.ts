import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CameraDevice, CameraDriver } from '@shared/types'
import { CameraError, isJpeg, runCommand, type Runner } from './exec'
import { sleep } from '../util'

const DEFAULT_PATHS = [
  'C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe',
  'C:\\Program Files\\digiCamControl\\CameraControlCmd.exe'
]

/** Locate CameraControlCmd.exe: explicit path > env DIGICAMCONTROL_PATH > default install dirs. */
export function resolveDigiCamPath(explicit?: string, exists: (p: string) => boolean = existsSync): string {
  if (explicit) return explicit
  if (process.env.DIGICAMCONTROL_PATH) return process.env.DIGICAMCONTROL_PATH
  return DEFAULT_PATHS.find(p => exists(p)) ?? DEFAULT_PATHS[0]
}

/** `/capture /filename <file>` (digiCamControl command line). */
export function captureArgs(file: string): string[] { return ['/filename', file, '/capture'] }

/**
 * Parse the output of `CameraControlCmd.exe /list`. digiCamControl prints one camera per line, roughly
 * "1: Canon EOS 700D" or just the model name, interleaved with log noise. Tolerant parser.
 */
export function parseList(stdout: string): CameraDevice[] {
  const out: CameraDevice[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^(error|warn|info|debug|digicam|usage|list|command|\[)/i.test(line) || /no (camera|device)/i.test(line)) continue
    const m = /^(?:\d+\s*[:.)-]\s*)?(?:camera\s*[:=-]\s*)?(.+)$/i.exec(line)
    if (m && m[1].length > 2 && /[a-z]/i.test(m[1]) && !/[{}<>]/.test(m[1])) out.push({ id: `digicam:${m[1].trim()}`, label: m[1].trim(), kind: 'dslr' })
  }
  return out
}

export interface DigiCamOptions { exe?: string; run?: Runner; retries?: number; retryDelayMs?: number; timeoutMs?: number; tmpRoot?: string; sleep?: (ms: number) => Promise<void> }

export class DigiCamControlCamera implements CameraDriver {
  readonly kind = 'dslr' as const
  private readonly exe: string
  private readonly run: Runner
  private readonly retries: number
  private readonly retryDelayMs: number
  private readonly timeoutMs: number
  private readonly tmpRoot: string
  private readonly sleepFn: (ms: number) => Promise<void>
  constructor(o: DigiCamOptions = {}) {
    this.exe = resolveDigiCamPath(o.exe)
    this.run = o.run ?? runCommand
    this.retries = o.retries ?? 3
    this.retryDelayMs = o.retryDelayMs ?? 1500
    this.timeoutMs = o.timeoutMs ?? 40000
    this.tmpRoot = o.tmpRoot ?? tmpdir()
    this.sleepFn = o.sleep ?? sleep
  }

  async list(): Promise<CameraDevice[]> {
    try {
      const r = await this.run(this.exe, ['/list'], { timeoutMs: 10000 })
      return r.timedOut ? [] : parseList(r.stdout.toString('utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  async connect(_id: string): Promise<void> {
    if (process.platform === 'win32' && !existsSync(this.exe)) throw new CameraError('not-installed', `CameraControlCmd.exe not found at ${this.exe}`)
  }

  async capture(): Promise<Buffer> {
    const dir = await mkdtemp(join(this.tmpRoot, 'booth-dcc-'))
    const file = join(dir, 'capture.jpg')
    try {
      let last: CameraError | undefined
      for (let attempt = 1; attempt <= this.retries; attempt++) {
        try {
          const r = await this.run(this.exe, captureArgs(file), { timeoutMs: this.timeoutMs })
          if (r.timedOut) throw new CameraError('timeout', 'digiCamControl capture timed out')
          let buf: Buffer | undefined
          try { buf = await readFile(file) } catch { /* not written */ }
          if (buf && isJpeg(buf)) return buf
          const text = `${r.stdout.toString()} ${r.stderr}`.toLowerCase()
          throw new CameraError(/no camera|no device|not connected/.test(text) ? 'no-device' : /busy/.test(text) ? 'busy' : 'failed',
            `digiCamControl produced no image (exit ${r.code}). ${text.trim().slice(0, 200)}`)
        } catch (e) {
          if (e instanceof CameraError) last = e
          else if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new CameraError('not-installed', `CameraControlCmd.exe not found at ${this.exe}`)
          else throw e
          if (last.code === 'no-device') throw last
          if (attempt < this.retries) await this.sleepFn(this.retryDelayMs * attempt)
        }
      }
      throw last ?? new CameraError('failed', 'capture failed')
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async disconnect(): Promise<void> { /* stateless */ }
}
