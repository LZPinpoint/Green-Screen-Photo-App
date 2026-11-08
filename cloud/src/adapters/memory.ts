import type { BlobStore, Clock, Db, OptinRow, SessionRow, Venue } from '../types'

export class MemoryBlobStore implements BlobStore {
  readonly map = new Map<string, { bytes: Uint8Array; contentType: string }>()
  async put(key: string, bytes: Uint8Array, contentType: string) { this.map.set(key, { bytes: new Uint8Array(bytes), contentType }) }
  async get(key: string) { return this.map.get(key) ?? null }
  async delete(key: string) { this.map.delete(key) }
}

export class SystemClock implements Clock { now() { return Date.now() } }
export class FakeClock implements Clock {
  constructor(public t = 1_700_000_000_000) {}
  now() { return this.t }
  advance(ms: number) { this.t += ms }
}

interface Snapshot {
  venues: Venue[]; sessions: SessionRow[]; optins: OptinRow[]
}

/** In-memory Db. Optional `onChange` lets the dev server persist a JSON snapshot. */
export class MemoryDb implements Db {
  private venues = new Map<string, Venue>()
  private sessions = new Map<string, SessionRow>()
  private optins = new Map<string, OptinRow>()
  private rates = new Map<string, { start: number; count: number }>()
  onChange?: () => void

  private changed() { this.onChange?.() }
  snapshot(): Snapshot { return { venues: [...this.venues.values()], sessions: [...this.sessions.values()], optins: [...this.optins.values()] } }
  load(s: Snapshot) {
    s.venues.forEach((v) => this.venues.set(v.id, v))
    s.sessions.forEach((v) => this.sessions.set(v.id, v))
    s.optins.forEach((v) => this.optins.set(v.id, v))
  }

  async getVenue(id: string) { return this.venues.get(id) ?? null }
  async putVenue(v: Venue) { this.venues.set(v.id, { ...v }); this.changed() }
  async listVenues() { return [...this.venues.values()] }
  async insertSession(s: SessionRow) {
    if (this.sessions.has(s.id)) return false
    this.sessions.set(s.id, { ...s }); this.changed(); return true
  }
  async getSession(id: string) { const s = this.sessions.get(id); return s ? { ...s } : null }
  async updateSession(id: string, patch: Partial<SessionRow>) {
    const s = this.sessions.get(id); if (s) { Object.assign(s, patch); this.changed() }
  }
  async deleteSession(id: string) { this.sessions.delete(id); this.changed() }
  async listSessionsByVenue(venueId: string, olderThan?: number) {
    return [...this.sessions.values()].filter((s) => s.venueId === venueId && (olderThan === undefined || s.createdAt < olderThan))
  }
  async listExpiredSessions(now: number) { return [...this.sessions.values()].filter((s) => s.expiresAt <= now) }

  async getOptin(sessionId: string, emailHash: string) {
    return [...this.optins.values()].find((o) => o.sessionId === sessionId && o.emailHash === emailHash) ?? null
  }
  async putOptin(o: OptinRow) { this.optins.set(o.id, { ...o }); this.changed() }
  async deleteOptinsForSession(sessionId: string, onlyNonMarketing = false) {
    let n = 0
    for (const [k, o] of this.optins) if (o.sessionId === sessionId && !(onlyNonMarketing && o.marketingOptIn)) { this.optins.delete(k); n++ }
    if (n) this.changed()
    return n
  }
  async deleteOptin(sessionId: string, emailHash: string) {
    let n = 0
    for (const [k, o] of this.optins) if (o.sessionId === sessionId && o.emailHash === emailHash) { this.optins.delete(k); n++ }
    if (n) this.changed()
    return n
  }
  async listMarketingOptins(venueId: string) {
    return [...this.optins.values()].filter((o) => o.venueId === venueId && o.marketingOptIn && o.email)
      .sort((a, b) => a.consentAt - b.consentAt)
  }
  async deleteOptinsOlderThan(venueId: string, ts: number) {
    let n = 0
    for (const [k, o] of this.optins) if (o.venueId === venueId && o.consentAt < ts) { this.optins.delete(k); n++ }
    if (n) this.changed()
    return n
  }
  async hit(key: string, windowMs: number, now: number) {
    const r = this.rates.get(key)
    if (!r || now - r.start >= windowMs) { this.rates.set(key, { start: now, count: 1 }); return 1 }
    r.count++
    return r.count
  }
}
