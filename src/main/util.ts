import { mkdir, rename, writeFile, readFile, copyFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

/** Atomic JSON write: write to temp file in same dir, then rename. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

/** Read JSON; missing -> fallback; corrupt -> keep a .corrupt copy and return fallback. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let txt: string
  try { txt = await readFile(file, 'utf8') } catch { return fallback }
  try { return JSON.parse(txt) as T } catch {
    try { await copyFile(file, `${file}.corrupt-${Date.now()}`) } catch { /* ignore */ }
    return fallback
  }
}

export function parseDataUrl(dataUrl: string): { mime: string; buf: Buffer; ext: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('invalid data URL')
  const mime = m[1].toLowerCase()
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
  const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'bin'
  if (ext === 'bin') throw new Error(`unsupported image type ${mime}`)
  return { mime, buf, ext }
}
export function toDataUrl(buf: Buffer, mime: string): string { return `data:${mime};base64,${buf.toString('base64')}` }
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Serializes async tasks (simple mutex) so read-modify-write on JSON files can't interleave. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn)
    this.tail = p.catch(() => undefined)
    return p
  }
}
