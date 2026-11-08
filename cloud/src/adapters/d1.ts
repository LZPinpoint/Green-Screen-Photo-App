import type { Db, OptinRow, SessionRow, Venue } from '../types'

// Minimal structural types for D1 (so no @cloudflare/workers-types needed).
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ meta?: { changes?: number } }>
}
export interface D1Like { prepare(sql: string): D1StatementLike }

type Row = Record<string, any>
const venue = (r: Row): Venue => ({
  id: r.id, name: r.name, welcomeText: r.welcome_text, apiKeyHash: r.api_key_hash, adminKeyHash: r.admin_key_hash,
  retentionDays: r.retention_days, optinRetentionDays: r.optin_retention_days, createdAt: r.created_at,
})
const session = (r: Row): SessionRow => ({
  id: r.id, venueId: r.venue_id, createdAt: r.created_at, scene: r.scene, layout: r.layout,
  hasImage: !!r.has_image, hasThumb: !!r.has_thumb, imageType: r.image_type, imageBytes: r.image_bytes, expiresAt: r.expires_at,
})
const optin = (r: Row): OptinRow => ({
  id: r.id, sessionId: r.session_id, venueId: r.venue_id, email: r.email, emailHash: r.email_hash,
  consentVersion: r.consent_version, consentAt: r.consent_at, marketingOptIn: !!r.marketing_opt_in, lastSentAt: r.last_sent_at,
})
const COLS: Record<keyof SessionRow, string> = {
  id: 'id', venueId: 'venue_id', createdAt: 'created_at', scene: 'scene', layout: 'layout', hasImage: 'has_image',
  hasThumb: 'has_thumb', imageType: 'image_type', imageBytes: 'image_bytes', expiresAt: 'expires_at',
}

export class D1Db implements Db {
  constructor(private d1: D1Like) {}
  private q(sql: string, ...args: unknown[]) { return this.d1.prepare(sql).bind(...args) }

  async getVenue(id: string) { const r = await this.q('SELECT * FROM venues WHERE id = ?', id).first<Row>(); return r ? venue(r) : null }
  async putVenue(v: Venue) {
    await this.q(
      `INSERT INTO venues (id,name,welcome_text,api_key_hash,admin_key_hash,retention_days,optin_retention_days,created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, welcome_text=excluded.welcome_text, api_key_hash=excluded.api_key_hash,
         admin_key_hash=excluded.admin_key_hash, retention_days=excluded.retention_days, optin_retention_days=excluded.optin_retention_days`,
      v.id, v.name, v.welcomeText, v.apiKeyHash, v.adminKeyHash, v.retentionDays, v.optinRetentionDays, v.createdAt,
    ).run()
  }
  async listVenues() { return (await this.q('SELECT * FROM venues').all<Row>()).results.map(venue) }

  async insertSession(s: SessionRow) {
    const r = await this.q(
      `INSERT OR IGNORE INTO sessions (id,venue_id,created_at,scene,layout,has_image,has_thumb,image_type,image_bytes,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      s.id, s.venueId, s.createdAt, s.scene, s.layout, s.hasImage ? 1 : 0, s.hasThumb ? 1 : 0, s.imageType, s.imageBytes, s.expiresAt,
    ).run()
    return (r.meta?.changes ?? 0) > 0
  }
  async getSession(id: string) { const r = await this.q('SELECT * FROM sessions WHERE id = ?', id).first<Row>(); return r ? session(r) : null }
  async updateSession(id: string, patch: Partial<SessionRow>) {
    const keys = (Object.keys(patch) as (keyof SessionRow)[]).filter((k) => k in COLS && k !== 'id')
    if (!keys.length) return
    const vals = keys.map((k) => { const v = patch[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : v })
    await this.q(`UPDATE sessions SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')} WHERE id = ?`, ...vals, id).run()
  }
  async deleteSession(id: string) { await this.q('DELETE FROM sessions WHERE id = ?', id).run() }
  async listSessionsByVenue(venueId: string, olderThan?: number) {
    const r = olderThan === undefined
      ? await this.q('SELECT * FROM sessions WHERE venue_id = ?', venueId).all<Row>()
      : await this.q('SELECT * FROM sessions WHERE venue_id = ? AND created_at < ?', venueId, olderThan).all<Row>()
    return r.results.map(session)
  }
  async listExpiredSessions(now: number) { return (await this.q('SELECT * FROM sessions WHERE expires_at <= ?', now).all<Row>()).results.map(session) }

  async getOptin(sessionId: string, emailHash: string) {
    const r = await this.q('SELECT * FROM optins WHERE session_id = ? AND email_hash = ?', sessionId, emailHash).first<Row>()
    return r ? optin(r) : null
  }
  async putOptin(o: OptinRow) {
    await this.q(
      `INSERT OR REPLACE INTO optins (id,session_id,venue_id,email,email_hash,consent_version,consent_at,marketing_opt_in,last_sent_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      o.id, o.sessionId, o.venueId, o.email, o.emailHash, o.consentVersion, o.consentAt, o.marketingOptIn ? 1 : 0, o.lastSentAt,
    ).run()
  }
  async deleteOptinsForSession(sessionId: string, onlyNonMarketing = false) {
    const r = await this.q(`DELETE FROM optins WHERE session_id = ?${onlyNonMarketing ? ' AND marketing_opt_in = 0' : ''}`, sessionId).run()
    return r.meta?.changes ?? 0
  }
  async deleteOptin(sessionId: string, emailHash: string) {
    const r = await this.q('DELETE FROM optins WHERE session_id = ? AND email_hash = ?', sessionId, emailHash).run()
    return r.meta?.changes ?? 0
  }
  async listMarketingOptins(venueId: string) {
    return (await this.q('SELECT * FROM optins WHERE venue_id = ? AND marketing_opt_in = 1 AND email IS NOT NULL ORDER BY consent_at', venueId).all<Row>()).results.map(optin)
  }
  async deleteOptinsOlderThan(venueId: string, ts: number) {
    const r = await this.q('DELETE FROM optins WHERE venue_id = ? AND consent_at < ?', venueId, ts).run()
    return r.meta?.changes ?? 0
  }
  async hit(key: string, windowMs: number, now: number) {
    const r = await this.q(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END
       RETURNING count`,
      key, now, now, windowMs, now, windowMs, now,
    ).first<{ count: number }>()
    return r?.count ?? 1
  }
}
