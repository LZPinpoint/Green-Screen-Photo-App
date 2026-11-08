import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { BlobStore } from '../types'

/** BlobStore on a local directory (dev server / self-hosting). Keys are `<id>/<name>`; content type kept in a sidecar. */
export class FileBlobStore implements BlobStore {
  private root: string
  constructor(root: string) { this.root = resolve(root) }
  private path(key: string) {
    const p = resolve(join(this.root, key))
    if (!p.startsWith(this.root + sep)) throw new Error('bad key')
    return p
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, bytes)
    await writeFile(p + '.type', contentType)
  }
  async get(key: string) {
    try {
      const p = this.path(key)
      const bytes = new Uint8Array(await readFile(p))
      const contentType = await readFile(p + '.type', 'utf8').catch(() => 'application/octet-stream')
      return { bytes, contentType }
    } catch { return null }
  }
  async delete(key: string) {
    const p = this.path(key)
    await rm(p, { force: true }); await rm(p + '.type', { force: true })
  }
}
