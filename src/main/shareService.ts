import { join } from 'node:path'
import type { BoothAPI, Session, ShareSettings } from '@shared/types'
import { ShareClient, ShareQueue, newShareId, nodeQueueFs } from './share'
import type { FetchLike } from './share'
import type { SettingsStore } from './store/settings'
import type { SessionStore } from './store/sessions'
import { log } from './logger'

type ShareApi = BoothAPI['share']

/**
 * Glue between the booth and the cloud gallery. Offline-first: every network call goes through the persisted
 * ShareQueue, so a dead wifi link never blocks a guest. When sharing is not configured everything is a no-op.
 */
export class ShareService {
  private queue: ShareQueue
  private cfg: ShareSettings | undefined
  private reserved = new Map<string, { shareId: string; guestUrl: string }>()

  constructor(private o: { dataDir: string; settings: SettingsStore; sessions: SessionStore; fetchImpl?: FetchLike }) {
    const client = new ShareClient(() => {
      const c = this.cfg
      return { baseUrl: c?.baseUrl ?? 'http://invalid.local', venueId: c?.venueId ?? '', apiKey: c?.apiKey ?? '' }
    }, o.fetchImpl)
    this.queue = new ShareQueue({ dir: join(o.dataDir, 'share-queue'), client, fs: nodeQueueFs })
    this.queue.on('failed', e => log.error(`share ${e.kind} failed (${e.shareId}): ${e.error}`))
  }

  async start(): Promise<void> { await this.refresh(); await this.queue.start() }
  async stop(): Promise<void> { await this.queue.flush().catch(() => {}); this.queue.stop() }

  /** re-read settings; returns the active config or undefined when sharing is off/incomplete */
  private async refresh(): Promise<ShareSettings | undefined> {
    const s = (await this.o.settings.get()).share
    this.cfg = s && s.enabled && s.baseUrl && s.venueId && s.apiKey ? s : undefined
    return this.cfg
  }

  async enabled(): Promise<boolean> { return !!(await this.refresh()) }

  async reserve(sessionId: string) {
    if (!(await this.refresh())) return null
    const hit = this.reserved.get(sessionId)
    if (hit) return hit
    const shareId = newShareId()
    const r = { shareId, guestUrl: `${this.cfg!.baseUrl.replace(/\/+$/, '')}/g/${shareId}` }
    this.reserved.set(sessionId, r)
    if (this.reserved.size > 200) this.reserved.delete(this.reserved.keys().next().value as string)
    return r
  }

  /** Called after the final composite is saved. Uploads only if a link was reserved for this session. */
  async onComposite(session: Session): Promise<void> {
    const r = this.reserved.get(session.id)
    if (!r || !session.composite || !(await this.refresh())) return
    const layout = (await this.o.settings.get()).defaultLayoutId
    this.queue.enqueueUpload({
      sessionId: session.id, filePath: join(this.o.dataDir, session.composite), shareId: r.shareId,
      meta: { createdAt: session.createdAt, scene: session.sceneId, layout }
    })
  }

  async email(shareId: string, email: string, consent: boolean, marketingOptIn: boolean) {
    if (!consent) throw new Error('consent required')
    if (!(await this.refresh())) throw new Error('sharing is not configured')
    const r = this.queue.enqueueEmail({ shareId, email, consent, marketingOptIn })
    const sid = [...this.reserved.entries()].find(([, v]) => v.shareId === shareId)?.[0]
    if (sid) await this.o.sessions.patch(sid, { emailed: marketingOptIn ? email : 'yes' }).catch(() => {})
    return r
  }

  status() { const { pending, failed, total } = this.queue.status(); return { pending, failed, total } }
  api(): ShareApi {
    return {
      enabled: () => this.enabled(), reserve: id => this.reserve(id),
      email: (a, b, c, d) => this.email(a, b, c, d), status: async () => this.status()
    }
  }
}
