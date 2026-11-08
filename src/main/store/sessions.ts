import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ImageData64, Session } from '@shared/types'
import { Mutex, parseDataUrl, readJson, writeJsonAtomic } from '../util'

export interface StoredSession extends Session { purgedAt?: number }
export interface StatsSummary { sessions: number; prints: number; byScene: Record<string, number>; byDay: Record<string, number> }

export const dayKey = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Sessions live in <dataDir>/sessions/<id>/{session.json,raw/,keyed/,composite/}. Paths in Session are relative to dataDir (posix). */
export class SessionStore {
  private readonly mutex = new Mutex()
  private readonly root: string
  constructor(private readonly dataDir: string, private readonly now: () => number = Date.now) { this.root = join(dataDir, 'sessions') }

  private dir(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid session id')
    return join(this.root, id)
  }
  private jsonFile(id: string): string { return join(this.dir(id), 'session.json') }

  async start(): Promise<Session> {
    const createdAt = this.now()
    const id = `${createdAt.toString(36)}-${randomBytes(3).toString('hex')}`
    const s: StoredSession = { id, createdAt, shots: [], printed: 0 }
    await mkdir(this.dir(id), { recursive: true })
    await writeJsonAtomic(this.jsonFile(id), s)
    return s
  }

  async get(id: string): Promise<Session | undefined> {
    try { return await readJson<StoredSession | undefined>(this.jsonFile(id), undefined) } catch { return undefined }
  }

  /** Serialized read-modify-write on one session. */
  update(id: string, fn: (s: StoredSession) => void | Promise<void>): Promise<Session> {
    return this.mutex.run(async () => {
      const s = (await this.get(id)) as StoredSession | undefined
      if (!s) throw new Error(`session ${id} not found`)
      await fn(s)
      await writeJsonAtomic(this.jsonFile(id), s)
      return s
    })
  }

  patch(id: string, p: Partial<Pick<Session, 'sceneId' | 'frameId' | 'emailed' | 'test'>>): Promise<Session> {
    return this.update(id, s => {
      if (p.sceneId !== undefined) s.sceneId = p.sceneId
      if (p.frameId !== undefined) s.frameId = p.frameId
      if (p.emailed !== undefined) s.emailed = p.emailed
      if (p.test !== undefined) s.test = p.test
    })
  }

  private async writeImage(id: string, sub: string, name: string, dataUrl: ImageData64): Promise<string> {
    const { buf, ext } = parseDataUrl(dataUrl)
    const rel = `sessions/${id}/${sub}/${name}.${ext}`
    await mkdir(join(this.dir(id), sub), { recursive: true })
    await writeFile(join(this.dataDir, rel), buf)
    return rel
  }

  saveShot(id: string, dataUrl: ImageData64): Promise<Session> {
    return this.update(id, async s => {
      const raw = await this.writeImage(id, 'raw', `shot-${s.shots.length + 1}`, dataUrl)
      s.shots.push({ raw })
    })
  }

  /** Extra (not in BoothAPI): store the keyed PNG for shot `index`. */
  saveKeyed(id: string, index: number, dataUrl: ImageData64): Promise<Session> {
    return this.update(id, async s => {
      if (!s.shots[index]) throw new Error(`shot ${index} not found`)
      s.shots[index].keyed = await this.writeImage(id, 'keyed', `shot-${index + 1}`, dataUrl)
    })
  }

  saveComposite(id: string, dataUrl: ImageData64): Promise<Session> {
    return this.update(id, async s => { s.composite = await this.writeImage(id, 'composite', 'composite', dataUrl) })
  }

  async list(limit?: number): Promise<Session[]> {
    let names: string[] = []
    try { names = await readdir(this.root) } catch { return [] }
    const all = (await Promise.all(names.map(n => this.get(n)))).filter((s): s is Session => !!s)
    all.sort((a, b) => b.createdAt - a.createdAt)
    return limit && limit > 0 ? all.slice(0, limit) : all
  }

  async stats(): Promise<StatsSummary> {
    const out: StatsSummary = { sessions: 0, prints: 0, byScene: {}, byDay: {} }
    for (const s of await this.list()) {
      if (s.test) continue
      out.sessions++
      out.prints += s.printed
      if (s.sceneId) out.byScene[s.sceneId] = (out.byScene[s.sceneId] ?? 0) + 1
      const d = dayKey(s.createdAt)
      out.byDay[d] = (out.byDay[d] ?? 0) + 1
    }
    return out
  }

  /** Delete image files of sessions older than `days`; session.json (stats) is kept with shots cleared. Returns purged count. */
  purgeOlderThan(days: number): Promise<number> {
    if (!(days > 0)) return Promise.resolve(0)
    return this.mutex.run(async () => {
      const cutoff = this.now() - days * 86_400_000
      let n = 0
      for (const s of (await this.list()) as StoredSession[]) {
        if (s.createdAt >= cutoff || s.purgedAt) continue
        for (const sub of ['raw', 'keyed', 'composite']) await rm(join(this.dir(s.id), sub), { recursive: true, force: true })
        s.shots = []
        delete s.composite
        s.purgedAt = this.now()
        await writeJsonAtomic(this.jsonFile(s.id), s)
        n++
      }
      return n
    })
  }
}

/** Run `fn` now and every 24h (timer unref'd). Returns stop(). */
export function scheduleDaily(fn: () => Promise<unknown>, onError: (e: unknown) => void = () => undefined): () => void {
  const run = () => { fn().catch(onError) }
  const first = setTimeout(run, 30_000)
  const t = setInterval(run, 86_400_000)
  first.unref?.(); t.unref?.()
  return () => { clearTimeout(first); clearInterval(t) }
}
