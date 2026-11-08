import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { BackgroundScene, FrameOverlay, ImageData64, PrintLayout } from '@shared/types'
import { Mutex, parseDataUrl, readJson, toDataUrl, writeJsonAtomic } from '../util'
import { SEED_FRAMES, SEED_LAYOUTS, renderSeedFrame, renderSeedScene, seedSceneMeta } from './seed'
import sharp from 'sharp'

interface LibraryFile { scenes: BackgroundScene[]; frames: FrameOverlay[]; layouts: PrintLayout[] }
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export class LibraryStore {
  private readonly mutex = new Mutex()
  private cache?: LibraryFile
  private readonly file: string
  /** extraRoots: read-only fallback dirs for imageUrl (e.g. packaged resources/). */
  constructor(private readonly dataDir: string, private readonly extraRoots: string[] = []) { this.file = join(dataDir, 'library.json') }

  /** Load library.json, seeding layouts/scenes/frame (and their image files) on first run. */
  private load(): Promise<LibraryFile> {
    return this.mutex.run(async () => {
      if (this.cache) return this.cache
      const existing = await readJson<LibraryFile | undefined>(this.file, undefined)
      if (existing) { this.cache = { scenes: existing.scenes ?? [], frames: existing.frames ?? [], layouts: existing.layouts ?? [] }; return this.cache }
      const lib: LibraryFile = { scenes: seedSceneMeta(), frames: SEED_FRAMES.map(f => ({ ...f })), layouts: SEED_LAYOUTS.map(l => ({ ...l })) }
      for (const s of lib.scenes) {
        const { full, thumb } = await renderSeedScene(s.id)
        await this.writeRel(s.file, full)
        if (s.thumb) await this.writeRel(s.thumb, thumb)
      }
      await this.writeRel(lib.frames[0].file, await renderSeedFrame())
      await writeJsonAtomic(this.file, lib)
      this.cache = lib
      return lib
    })
  }
  private async writeRel(rel: string, buf: Buffer): Promise<void> {
    const abs = this.safePath(rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, buf)
  }
  private persist(lib: LibraryFile): Promise<void> { return writeJsonAtomic(this.file, lib) }

  /** Resolve a relative path inside dataDir; rejects traversal. */
  private safePath(rel: string, root = this.dataDir): string {
    const abs = resolve(root, rel)
    if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) throw new Error('path escapes data dir')
    return abs
  }

  async scenes(): Promise<BackgroundScene[]> { return structuredClone((await this.load()).scenes) }
  async frames(): Promise<FrameOverlay[]> { return structuredClone((await this.load()).frames) }
  async layouts(): Promise<PrintLayout[]> { return structuredClone((await this.load()).layouts) }

  async saveScene(s: BackgroundScene, imageDataUrl?: ImageData64): Promise<void> {
    const lib = await this.load()
    if (!/^[A-Za-z0-9_-]+$/.test(s.id)) throw new Error('invalid scene id')
    const scene = { ...s }
    if (imageDataUrl) {
      const { buf } = parseDataUrl(imageDataUrl)
      scene.file = `backgrounds/${s.id}.jpg`
      scene.thumb = `backgrounds/${s.id}.thumb.jpg`
      await this.writeRel(scene.file, await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer())
      await this.writeRel(scene.thumb, await sharp(buf).rotate().resize(360, 240, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer())
    }
    await this.mutex.run(async () => {
      const i = lib.scenes.findIndex(x => x.id === s.id)
      if (i >= 0) lib.scenes[i] = scene; else lib.scenes.push(scene)
      await this.persist(lib)
    })
  }

  async saveFrame(f: FrameOverlay, imageDataUrl?: ImageData64): Promise<void> {
    const lib = await this.load()
    if (!/^[A-Za-z0-9_-]+$/.test(f.id)) throw new Error('invalid frame id')
    const frame = { ...f }
    if (imageDataUrl) {
      const { buf } = parseDataUrl(imageDataUrl)
      frame.file = `frames/${f.id}.png`
      await this.writeRel(frame.file, await sharp(buf).png().toBuffer())
    }
    await this.mutex.run(async () => {
      const i = lib.frames.findIndex(x => x.id === f.id)
      if (i >= 0) lib.frames[i] = frame; else lib.frames.push(frame)
      await this.persist(lib)
    })
  }

  async saveLayout(l: PrintLayout): Promise<void> {
    const lib = await this.load()
    if (!/^[A-Za-z0-9_-]+$/.test(l.id)) throw new Error('invalid layout id')
    if (![1, 2, 3, 4].includes(l.photosPerSheet)) throw new Error('photosPerSheet must be 1-4')
    await this.mutex.run(async () => {
      const i = lib.layouts.findIndex(x => x.id === l.id)
      if (i >= 0) lib.layouts[i] = { ...l }; else lib.layouts.push({ ...l })
      await this.persist(lib)
    })
  }

  async deleteScene(id: string): Promise<void> {
    const lib = await this.load()
    await this.mutex.run(async () => {
      const i = lib.scenes.findIndex(x => x.id === id)
      if (i < 0) return
      const [gone] = lib.scenes.splice(i, 1)
      await this.persist(lib)
      for (const f of [gone.file, gone.thumb]) if (f) await rm(this.safePath(f), { force: true }).catch(() => undefined)
    })
  }

  /** `file` is relative to the data dir; bare names are looked up in backgrounds/ then frames/ then logos/. */
  async imageUrl(file: string): Promise<ImageData64> {
    await this.load()
    const candidates = [file, `backgrounds/${file}`, `frames/${file}`, `logos/${file}`]
    const roots = [this.dataDir, ...this.extraRoots]
    for (const root of roots) for (const c of candidates) {
      let abs: string
      try { abs = this.safePath(c, root) } catch { continue }
      if (!existsSync(abs)) continue
      const ext = abs.split('.').pop()!.toLowerCase()
      if (!MIME[ext]) continue
      return toDataUrl(await readFile(abs), MIME[ext])
    }
    throw new Error(`image not found: ${file}`)
  }
}
