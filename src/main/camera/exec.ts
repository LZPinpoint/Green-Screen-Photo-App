import { spawn } from 'node:child_process'

export interface RunResult { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean }

/** Spawn a command, collecting stdout as a Buffer (binary-safe, needed for `gphoto2 --stdout`). Never rejects on non-zero exit; rejects on spawn failure (ENOENT). */
export function runCommand(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    const out: Buffer[] = []
    let err = ''
    let timedOut = false
    let settled = false
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, opts.timeoutMs) : undefined
    child.stdout?.on('data', (d: Buffer) => out.push(d))
    child.stderr?.on('data', (d: Buffer) => { err += d.toString() })
    child.on('error', e => { if (settled) return; settled = true; if (timer) clearTimeout(timer); reject(e) })
    child.on('close', code => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(out), stderr: err, timedOut })
    })
  })
}

export type Runner = typeof runCommand

export class CameraError extends Error {
  constructor(public readonly code: 'no-device' | 'busy' | 'timeout' | 'not-installed' | 'failed' | 'not-connected', message: string) {
    super(message)
    this.name = 'CameraError'
  }
}
export const isJpeg = (b: Buffer) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8
