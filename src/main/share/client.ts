export interface ShareConfig {
  baseUrl: string   // e.g. https://photos.example.org (no trailing slash needed)
  venueId: string
  apiKey: string    // venue key (booth uploads)
}

export class ShareHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string, readonly retryAfterSec?: number) {
    super(message ?? `${status} ${code}`)
    this.name = 'ShareHttpError'
  }
  /** Worth retrying later (network blip, server trouble, throttling). */
  get retryable() { return this.status === 0 || this.status === 408 || this.status === 425 || this.status === 429 || this.status >= 500 }
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: any; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(n: string): string | null }; json(): Promise<any>; text(): Promise<string>
}>

export function sniffImageType(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  return null
}

export class ShareClient {
  private fetchImpl: FetchLike
  constructor(private cfg: ShareConfig | (() => ShareConfig), fetchImpl?: FetchLike, private timeoutMs = 30_000) {
    this.fetchImpl = fetchImpl ?? ((u, i) => (globalThis.fetch as any)(u, i))
  }
  get config(): ShareConfig { const c = typeof this.cfg === 'function' ? this.cfg() : this.cfg; return { ...c, baseUrl: c.baseUrl.replace(/\/+$/, '') } }
  guestUrl(id: string) { return `${this.config.baseUrl}/g/${id}` }

  private async call<T>(path: string, init: { method: string; body?: any; headers?: Record<string, string>; auth?: boolean }): Promise<T> {
    const c = this.config
    const headers: Record<string, string> = { ...(init.headers ?? {}) }
    if (init.auth !== false) headers.authorization = `Bearer ${c.apiKey}`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let res
    try {
      res = await this.fetchImpl(c.baseUrl + path, { method: init.method, headers, body: init.body, signal: ctrl.signal })
    } catch (e) {
      throw new ShareHttpError(0, 'network', e instanceof Error ? e.message : String(e))
    } finally { clearTimeout(t) }
    if (!res.ok) {
      let code = 'http_' + res.status, msg: string | undefined
      try { const j = await res.json(); code = j.error ?? code; msg = j.message } catch { /* not json */ }
      const ra = Number(res.headers.get('retry-after'))
      throw new ShareHttpError(res.status, code, msg, Number.isFinite(ra) ? ra : undefined)
    }
    return (await res.json().catch(() => ({}))) as T
  }

  /** Create (or idempotently re-create) a session. Pass `id` to use a client-proposed id. */
  createSession(p: { id?: string; createdAt: number; scene?: string; layout?: string }) {
    return this.call<{ id: string; uploadUrl: string; guestUrl: string }>('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ venueId: this.config.venueId, ...p }),
    })
  }
  uploadImage(id: string, bytes: Uint8Array, contentType: string = sniffImageType(bytes) ?? 'image/jpeg', kind: 'image' | 'thumb' = 'image') {
    return this.call<{ ok: boolean }>(`/api/v1/sessions/${id}/${kind}`, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes })
  }
  uploadThumb(id: string, bytes: Uint8Array, contentType?: string) { return this.uploadImage(id, bytes, contentType, 'thumb') }
  /** Public endpoint (the session id is the capability); consent must be true. */
  sendEmail(id: string, p: { email: string; consent: boolean; marketingOptIn: boolean }) {
    return this.call<{ ok: boolean; duplicate?: boolean }>(`/api/v1/sessions/${id}/email`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), auth: false,
    })
  }
}
