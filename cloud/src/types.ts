// Adapter interfaces. Core logic only talks to these, so it runs in node tests with in-memory adapters.

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
  delete(key: string): Promise<void>
}

export interface Clock { now(): number }

export interface Venue {
  id: string
  name: string
  welcomeText: string
  apiKeyHash: string
  adminKeyHash: string
  retentionDays: number
  optinRetentionDays: number
  createdAt: number
}

export interface SessionRow {
  id: string
  venueId: string
  createdAt: number
  scene: string
  layout: string
  hasImage: boolean
  hasThumb: boolean
  imageType: string
  imageBytes: number
  expiresAt: number
}

export interface OptinRow {
  id: string
  sessionId: string
  venueId: string
  email: string | null          // only stored when marketingOptIn is true
  emailHash: string
  consentVersion: string
  consentAt: number
  marketingOptIn: boolean
  lastSentAt: number
}

/** Domain-level persistence. Implemented by MemoryDb (tests/dev) and D1Db (Cloudflare). */
export interface Db {
  getVenue(id: string): Promise<Venue | null>
  putVenue(v: Venue): Promise<void>
  /** Insert only if id unused. Returns false if it exists. */
  insertSession(s: SessionRow): Promise<boolean>
  getSession(id: string): Promise<SessionRow | null>
  updateSession(id: string, patch: Partial<SessionRow>): Promise<void>
  deleteSession(id: string): Promise<void>
  listSessionsByVenue(venueId: string, olderThan?: number): Promise<SessionRow[]>
  listExpiredSessions(now: number): Promise<SessionRow[]>
  getOptin(sessionId: string, emailHash: string): Promise<OptinRow | null>
  putOptin(o: OptinRow): Promise<void>
  deleteOptinsForSession(sessionId: string, onlyNonMarketing?: boolean): Promise<number>
  deleteOptin(sessionId: string, emailHash: string): Promise<number>
  listMarketingOptins(venueId: string): Promise<OptinRow[]>
  deleteOptinsOlderThan(venueId: string, ts: number): Promise<number>
  listVenues(): Promise<Venue[]>
  /** Fixed-window counter. Returns the count INCLUDING this hit. */
  hit(key: string, windowMs: number, now: number): Promise<number>
}

export interface EmailMessage {
  to: string
  from?: string
  subject: string
  text: string
  html: string
  headers?: Record<string, string>
}

export interface EmailProvider {
  readonly name: string
  send(msg: EmailMessage): Promise<void>
}

export interface Env {
  PUBLIC_BASE_URL?: string
  EMAIL_FROM?: string
  SIGNING_SECRET?: string
  ADMIN_KEY?: string
  RESEND_API_KEY?: string
}

export interface AppConfig {
  baseUrl?: string               // overrides request origin
  signingSecret: string
  adminKey?: string
  emailFrom: string
  maxImageBytes: number
  maxThumbBytes: number
  defaultRetentionDays: number
  consentVersion: string
  rateLimits: { emailPerIpPerHour: number; emailPerSessionPerHour: number; resendCooldownMs: number }
}

export interface AppContext {
  blobs: BlobStore
  db: Db
  email: EmailProvider
  clock: Clock
  config: AppConfig
}

export const DAY_MS = 86_400_000
