import type { CameraDevice, CameraDriver } from '@shared/types'
import { CameraError, isJpeg, runCommand, type Runner } from './exec'
import { sleep } from '../util'

/** Parse `gphoto2 --auto-detect` output into devices (id = "gphoto2:<port>"). Exported for tests. */
export function parseAutoDetect(stdout: string): CameraDevice[] {
  const devices: CameraDevice[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim() || /^Model\s+Port/i.test(line.trim()) || /^-{5,}/.test(line.trim())) continue
    // Model column is padded with 2+ spaces; port is the last whitespace-separated token (usb:001,004 / ptpip:...).
    const m = /^(.*?)\s{2,}(\S+)\s*$/.exec(line)
    if (!m) continue
    const [, model, port] = m
    if (/^usb:/i.test(port) || /^ptpip:/i.test(port) || /^serial:/i.test(port) || port.includes(':')) {
      devices.push({ id: `gphoto2:${port}`, label: model.trim(), kind: 'dslr' })
    }
  }
  return devices
}

export function captureArgs(port?: string): string[] {
  return [...(port ? ['--port', port] : []), '--capture-image-and-download', '--stdout']
}

export function classifyError(stderr: string): CameraError['code'] {
  const s = stderr.toLowerCase()
  if (/no camera found|unknown model|could not detect any camera|no cameras? (were )?detected/.test(s)) return 'no-device'
  if (/could not claim|device or resource busy|resource busy|i\/o in progress|camera is busy|ptp device busy|device busy|-53|-110/.test(s)) return 'busy'
  return 'failed'
}

export interface GPhoto2Options { bin?: string; run?: Runner; retries?: number; retryDelayMs?: number; captureTimeoutMs?: number; sleep?: (ms: number) => Promise<void> }

export class GPhoto2Camera implements CameraDriver {
  readonly kind = 'dslr' as const
  private port?: string
  private readonly bin: string
  private readonly run: Runner
  private readonly retries: number
  private readonly retryDelayMs: number
  private readonly captureTimeoutMs: number
  private readonly sleepFn: (ms: number) => Promise<void>
  constructor(o: GPhoto2Options = {}) {
    this.bin = o.bin ?? process.env.GPHOTO2_PATH ?? 'gphoto2'
    this.run = o.run ?? runCommand
    this.retries = o.retries ?? 3
    this.retryDelayMs = o.retryDelayMs ?? 1500
    this.captureTimeoutMs = o.captureTimeoutMs ?? 30000
    this.sleepFn = o.sleep ?? sleep
  }

  async list(): Promise<CameraDevice[]> {
    try {
      const r = await this.run(this.bin, ['--auto-detect'], { timeoutMs: 10000 })
      if (r.timedOut) return []
      return parseAutoDetect(r.stdout.toString('utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [] // gphoto2 not installed -> no DSLRs
      throw e
    }
  }

  async connect(id: string): Promise<void> {
    this.port = id.startsWith('gphoto2:') ? id.slice('gphoto2:'.length) : undefined
    const found = await this.list()
    if (!found.length) throw new CameraError('no-device', 'No camera detected by gphoto2. Check USB cable, camera power and that it is not in mass-storage mode.')
    if (this.port && !found.some(d => d.id === `gphoto2:${this.port}`)) throw new CameraError('no-device', `Camera on ${this.port} not found.`)
  }

  async capture(): Promise<Buffer> {
    let lastErr: CameraError | undefined
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const r = await this.run(this.bin, captureArgs(this.port), { timeoutMs: this.captureTimeoutMs })
        if (r.timedOut) throw new CameraError('timeout', `gphoto2 capture timed out after ${this.captureTimeoutMs}ms`)
        if (r.code === 0 && isJpeg(r.stdout)) return r.stdout
        const code = r.code === 0 ? 'failed' : classifyError(r.stderr)
        throw new CameraError(code, r.stderr.trim().split('\n').pop() || `gphoto2 exited with code ${r.code} and no JPEG data`)
      } catch (e) {
        if (e instanceof CameraError) lastErr = e
        else if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new CameraError('not-installed', 'gphoto2 is not installed or not on PATH (see docs/HARDWARE.md).')
        else throw e
        if (lastErr.code === 'no-device') throw lastErr // retrying won't help
        if (attempt < this.retries) await this.sleepFn(this.retryDelayMs * attempt)
      }
    }
    throw lastErr ?? new CameraError('failed', 'capture failed')
  }

  async disconnect(): Promise<void> { this.port = undefined }
}
