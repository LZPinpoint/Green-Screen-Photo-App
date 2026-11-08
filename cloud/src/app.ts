import { deleteToken, hmacHex, sha256Hex, timingSafeEqual, unsubToken } from './crypto'
import { toCsv } from './csv'
import { renderEmail } from './email/template'
import { renderGallery } from './html/gallery'
import { messagePage } from './html/layout'
import { esc, formatDate, nonce as makeNonce } from './html/util'
import { isValidId, newId, newKey } from './id'
import { AppContext, AppConfig, DAY_MS, SessionRow, Venue } from './types'

const VENUE_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const EMAIL_RE = /^[^\s@<>()\[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export const DEFAULT_CONFIG: Omit<AppConfig, 'signingSecret'> = {
  emailFrom: 'imagine <photos@example.org>',
  maxImageBytes: 15 * 1024 * 1024,
  maxThumbBytes: 2 * 1024 * 1024,
  defaultRetentionDays: 30,
  consentVersion: 'v1',
  rateLimits: { emailPerIpPerHour: 10, emailPerSessionPerHour: 5, resendCooldownMs: 5 * 60_000 },
}

// ---------- small http helpers ----------
const SEC_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
}
function withSec(res: Response, extra?: Record<string, string>): Response {
  const h = new Headers(res.headers)
  for (const [k, v] of Object.entries(SEC_HEADERS)) if (!h.has(k)) h.set(k, v)
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
const err = (status: number, error: string, message?: string, headers?: Record<string, string>) => json(status, { error, message: message ?? error }, headers)

function htmlResponse(status: number, body: string, nonce: string, extra: Record<string, string> = {}) {
  return withSec(new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra } }), {
    'content-security-policy':
      `default-src 'none'; img-src 'self' data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  })
}
function msgPage(status: number, title: string, bodyHtml: string) {
  const n = makeNonce()
  return htmlResponse(status, messagePage(n, title, bodyHtml), n)
}

async function readLimited(req: Request, max: number): Promise<Uint8Array | 'too_large'> {
  const declared = Number(req.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > max) return 'too_large'
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel().catch(() => {}); return 'too_large' }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await readLimited(req, 16 * 1024)
  if (raw === 'too_large') return null
  const text = new TextDecoder().decode(raw)
  const ct = req.headers.get('content-type') ?? ''
  try {
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text))
    const v = text ? JSON.parse(text) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch { return null }
}
const truthy = (v: unknown) => v === true || v === 'true' || v === '1' || v === 'on' || v === 'yes'

export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png'
  return null
}
const ext = (t: string) => (t === 'image/png' ? 'png' : 'jpg')
const bearer = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''
const clientIp = (req: Request) =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

const baseUrl = (ctx: AppContext, req: Request) => (ctx.config.baseUrl ?? new URL(req.url).origin).replace(/\/$/, '')
const blobKey = (id: string, kind: 'image' | 'thumb') => `${id}/${kind}`

// ---------- auth ----------
async function venueKeyOk(ctx: AppContext, req: Request, venue: Venue) {
  const k = bearer(req)
  return !!k && timingSafeEqual(await sha256Hex(k), venue.apiKeyHash)
}
async function adminOk(ctx: AppContext, req: Request, venue?: Venue) {
  const k = bearer(req)
  if (!k) return false
  if (ctx.config.adminKey && timingSafeEqual(k, ctx.config.adminKey)) return true
  return !!venue && timingSafeEqual(await sha256Hex(k), venue.adminKeyHash)
}

// ---------- session deletion ----------
export async function deleteSessionFully(ctx: AppContext, id: string, opts: { onlyNonMarketing?: boolean } = {}) {
  await ctx.blobs.delete(blobKey(id, 'image'))
  await ctx.blobs.delete(blobKey(id, 'thumb'))
  await ctx.db.deleteOptinsForSession(id, opts.onlyNonMarketing)
  await ctx.db.deleteSession(id)
}

// ---------- scheduled retention ----------
export async function runRetention(ctx: AppContext): Promise<{ sessions: number; optins: number }> {
  const now = ctx.clock.now()
  const seen = new Set<string>()
  let optins = 0
  for (const v of await ctx.db.listVenues()) {
    for (const s of await ctx.db.listSessionsByVenue(v.id, now - v.retentionDays * DAY_MS)) seen.add(s.id)
    optins += await ctx.db.deleteOptinsOlderThan(v.id, now - v.optinRetentionDays * DAY_MS)
  }
  for (const s of await ctx.db.listExpiredSessions(now)) seen.add(s.id)
  for (const id of seen) await deleteSessionFully(ctx, id, { onlyNonMarketing: true })
  return { sessions: seen.size, optins }
}

// ---------- router ----------
export async function handle(ctx: AppContext, req: Request): Promise<Response> {
  try {
    return withSec(await route(ctx, req))
  } catch (e) {
    console.error('unhandled', e)
    return withSec(err(500, 'internal_error'))
  }
}

async function route(ctx: AppContext, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const p = url.pathname.replace(/\/+$/, '') || '/'
  const m = req.method
  let r: RegExpExecArray | null

  if (p === '/healthz') return json(200, { ok: true })
  if (p === '/' ) return msgPage(200, 'imagine.', '<p class="lead">photo delivery for imagine booth.</p>')
  if (p === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } })

  if (p === '/api/v1/sessions' && m === 'POST') return createSession(ctx, req)
  if ((r = /^\/api\/v1\/sessions\/([^/]+)\/(image|thumb)$/.exec(p)) && m === 'PUT') return putImage(ctx, req, r[1], r[2] as 'image' | 'thumb')
  if ((r = /^\/api\/v1\/sessions\/([^/]+)\/email$/.exec(p)) && m === 'POST') return postEmail(ctx, req, r[1])
  if ((r = /^\/api\/v1\/venues\/([^/]+)$/.exec(p)) && m === 'PUT') return putVenue(ctx, req, r[1])
  if ((r = /^\/api\/v1\/venues\/([^/]+)\/optins\.csv$/.exec(p)) && m === 'GET') return optinsCsv(ctx, req, r[1])
  if ((r = /^\/api\/v1\/venues\/([^/]+)\/purge$/.exec(p)) && m === 'POST') return purgeVenue(ctx, req, r[1])

  if ((r = /^\/g\/([^/]+)$/.exec(p))) {
    if (m === 'GET' || m === 'HEAD') return gallery(ctx, req, r[1])
    if (m === 'DELETE') return guestDelete(ctx, req, r[1])
  }
  if ((r = /^\/g\/([^/]+)\/(image|thumb|download)$/.exec(p)) && (m === 'GET' || m === 'HEAD')) return serveImage(ctx, r[1], r[2] as 'image' | 'thumb' | 'download')
  if ((r = /^\/g\/([^/]+)\/delete$/.exec(p))) {
    if (m === 'GET') return deleteConfirmPage(ctx, req, r[1])
    if (m === 'POST') return deleteForm(ctx, req, r[1])
  }
  if ((r = /^\/u\/([^/]+)\/([^/]+)$/.exec(p))) {
    if (m === 'GET') return unsubPage(ctx, req, r[1], r[2])
    if (m === 'POST') return unsubDo(ctx, req, r[1], r[2])
  }
  return p.startsWith('/api/') ? err(404, 'not_found') : msgPage(404, 'not found', '<p class="lead">this page does not exist. the link may be wrong.</p>')
}

// ---------- venue admin ----------
async function putVenue(ctx: AppContext, req: Request, id: string) {
  if (!(await adminOk(ctx, req)) || !ctx.config.adminKey) return err(401, 'unauthorized')
  if (!VENUE_ID_RE.test(id)) return err(400, 'bad_venue_id')
  const body = await readBody(req)
  if (!body) return err(400, 'bad_json')
  const existing = await ctx.db.getVenue(id)
  const name = String(body.name ?? existing?.name ?? '').trim().slice(0, 80)
  if (!name) return err(400, 'name_required')
  const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 3650 ? Math.floor(n) : d }
  let apiKey: string | undefined, adminKey: string | undefined
  let apiKeyHash = existing?.apiKeyHash, adminKeyHash = existing?.adminKeyHash
  if (!existing || truthy(body.rotateKeys)) {
    apiKey = newKey('bk'); adminKey = newKey('vk')
    apiKeyHash = await sha256Hex(apiKey); adminKeyHash = await sha256Hex(adminKey)
  }
  const venue: Venue = {
    id, name,
    welcomeText: String(body.welcomeText ?? existing?.welcomeText ?? '').slice(0, 300),
    apiKeyHash: apiKeyHash!, adminKeyHash: adminKeyHash!,
    retentionDays: num(body.retentionDays, existing?.retentionDays ?? ctx.config.defaultRetentionDays),
    optinRetentionDays: num(body.optinRetentionDays, existing?.optinRetentionDays ?? 365),
    createdAt: existing?.createdAt ?? ctx.clock.now(),
  }
  await ctx.db.putVenue(venue)
  return json(existing ? 200 : 201, { id, name, retentionDays: venue.retentionDays, ...(apiKey ? { apiKey, adminKey, note: 'store these now; they are not shown again' } : {}) })
}

// ---------- sessions & uploads ----------
async function createSession(ctx: AppContext, req: Request) {
  const body = await readBody(req)
  if (!body) return err(400, 'bad_json')
  const venueId = String(body.venueId ?? '')
  const venue = venueId ? await ctx.db.getVenue(venueId) : null
  if (!venue || !(await venueKeyOk(ctx, req, venue))) return err(401, 'unauthorized')

  let id: string
  if (body.id !== undefined) {
    id = String(body.id)
    if (!isValidId(id)) return err(400, 'bad_id', 'id must be 22 base62 characters')
  } else id = newId()

  const now = ctx.clock.now()
  const proposed = Number(body.createdAt)
  const createdAt = Number.isFinite(proposed) && proposed <= now && proposed > now - 30 * DAY_MS ? Math.floor(proposed) : now
  const row: SessionRow = {
    id, venueId, createdAt, scene: String(body.scene ?? '').slice(0, 80), layout: String(body.layout ?? '').slice(0, 80),
    hasImage: false, hasThumb: false, imageType: '', imageBytes: 0, expiresAt: now + venue.retentionDays * DAY_MS,
  }
  const inserted = await ctx.db.insertSession(row)
  let status = 201
  if (!inserted) {
    const existing = await ctx.db.getSession(id)
    if (!existing || existing.venueId !== venueId) return err(409, 'id_taken') // never reveal other venue's session
    status = 200 // idempotent retry
  }
  const base = baseUrl(ctx, req)
  return json(status, {
    id, uploadUrl: `${base}/api/v1/sessions/${id}/image`, thumbUrl: `${base}/api/v1/sessions/${id}/thumb`, guestUrl: `${base}/g/${id}`,
  })
}

async function putImage(ctx: AppContext, req: Request, id: string, kind: 'image' | 'thumb') {
  if (!isValidId(id)) return err(404, 'not_found')
  const s = await ctx.db.getSession(id)
  const venue = s ? await ctx.db.getVenue(s.venueId) : null
  if (!s || !venue || !(await venueKeyOk(ctx, req, venue))) return err(s ? 401 : 404, s ? 'unauthorized' : 'not_found')
  const max = kind === 'image' ? ctx.config.maxImageBytes : ctx.config.maxThumbBytes
  const declaredType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (declaredType !== 'image/jpeg' && declaredType !== 'image/png') return err(415, 'unsupported_type', 'jpeg or png only')
  const bytes = await readLimited(req, max)
  if (bytes === 'too_large') return err(413, 'too_large', `max ${max} bytes`)
  const type = sniffImage(bytes)
  if (!type || type !== declaredType) return err(415, 'bad_image', 'file contents are not a valid jpeg/png')
  await ctx.blobs.put(blobKey(id, kind), bytes, type)
  await ctx.db.updateSession(id, kind === 'image' ? { hasImage: true, imageType: type, imageBytes: bytes.length } : { hasThumb: true })
  return json(200, { ok: true, bytes: bytes.length, type })
}

// ---------- gallery ----------
async function loadLive(ctx: AppContext, id: string): Promise<{ s: SessionRow; v: Venue } | 'gone' | null> {
  if (!isValidId(id)) return null
  const s = await ctx.db.getSession(id)
  if (!s) return null
  const v = await ctx.db.getVenue(s.venueId)
  if (!v) return null
  if (s.expiresAt <= ctx.clock.now()) return 'gone'
  return { s, v }
}
const gonePage = () => msgPage(410, 'photo expired', '<p class="lead">this photo has been deleted, as promised. thanks for visiting!</p>')

async function gallery(ctx: AppContext, req: Request, id: string) {
  const live = await loadLive(ctx, id)
  if (live === 'gone') return gonePage()
  if (!live) return msgPage(404, 'not found', '<p class="lead">we could not find that photo. it may have been deleted, or the link is wrong.</p>')
  const n = makeNonce()
  const html = renderGallery({
    venue: live.v, session: live.s, baseUrl: baseUrl(ctx, req), nonce: n, consentVersion: ctx.config.consentVersion,
    deleteToken: await deleteToken(ctx.config.signingSecret, id),
  })
  return htmlResponse(200, html, n)
}

async function serveImage(ctx: AppContext, id: string, which: 'image' | 'thumb' | 'download') {
  const live = await loadLive(ctx, id)
  if (live === 'gone') return gonePage()
  if (!live) return err(404, 'not_found')
  const key = blobKey(id, which === 'thumb' && live.s.hasThumb ? 'thumb' : 'image')
  const blob = live.s.hasImage ? await ctx.blobs.get(key) : null
  if (!blob) return err(404, 'not_found')
  const headers: Record<string, string> = {
    'content-type': blob.contentType, 'content-length': String(blob.bytes.length), 'cache-control': 'private, max-age=3600',
  }
  if (which === 'download') {
    headers['content-disposition'] = `attachment; filename="imagine-${id.slice(0, 8)}.${ext(blob.contentType)}"`
    headers['cache-control'] = 'no-store'
  } else headers['content-disposition'] = 'inline'
  return new Response(blob.bytes as unknown as BodyInit, { headers })
}

// ---------- guest delete ----------
async function tokenOk(ctx: AppContext, id: string, t: string | null | undefined) {
  return !!t && timingSafeEqual(t, await deleteToken(ctx.config.signingSecret, id))
}
async function guestDelete(ctx: AppContext, req: Request, id: string) {
  if (!isValidId(id)) return err(404, 'not_found')
  const t = req.headers.get('x-delete-token') ?? new URL(req.url).searchParams.get('t')
  if (!(await tokenOk(ctx, id, t))) return err(403, 'bad_token')
  if (!(await ctx.db.getSession(id))) return err(404, 'not_found')
  await deleteSessionFully(ctx, id)
  return json(200, { ok: true })
}
async function deleteConfirmPage(ctx: AppContext, req: Request, id: string) {
  const t = new URL(req.url).searchParams.get('t') ?? ''
  if (!isValidId(id) || !(await tokenOk(ctx, id, t))) return msgPage(403, 'link not valid', '<p class="lead">that delete link is not valid.</p>')
  if (!(await ctx.db.getSession(id))) return msgPage(404, 'not found', '<p class="lead">this photo is already gone.</p>')
  return msgPage(200, 'delete my photo?',
    `<p class="lead">this removes your photo and any email address linked to it. it cannot be undone.</p>
<form method="post" action="/g/${esc(id)}/delete"><input type="hidden" name="t" value="${esc(t)}">
<button class="btn primary" type="submit">yes, delete it</button> <a class="btn" href="/g/${esc(id)}">no, keep it</a></form>`)
}
async function deleteForm(ctx: AppContext, req: Request, id: string) {
  const body = await readBody(req)
  if (!isValidId(id) || !(await tokenOk(ctx, id, String(body?.t ?? '')))) return msgPage(403, 'link not valid', '<p class="lead">that delete link is not valid.</p>')
  await deleteSessionFully(ctx, id)
  return msgPage(200, 'deleted', '<p class="lead">your photo and any linked email address have been deleted.</p>')
}

// ---------- email ----------
async function postEmail(ctx: AppContext, req: Request, id: string) {
  const isForm = (req.headers.get('content-type') ?? '').includes('x-www-form-urlencoded')
  const fail = (status: number, error: string, message: string, headers?: Record<string, string>) =>
    isForm ? msgPage(status, 'oops', `<p class="lead">${esc(message)}</p><p><a class="btn" href="/g/${esc(id)}">back</a></p>`) : err(status, error, message, headers)
  const ok = (extra: Record<string, unknown> = {}) =>
    isForm ? msgPage(200, 'sent!', '<p class="lead">check your inbox (and spam folder) for the link to your photo.</p>') : json(200, { ok: true, ...extra })

  const body = await readBody(req)
  if (!body) return fail(400, 'bad_json', 'invalid request')
  if (typeof body.website === 'string' && body.website) return ok() // honeypot: pretend success
  if (!truthy(body.consent)) return fail(400, 'consent_required', 'please tick the consent box so we may email you')
  const email = String(body.email ?? '').trim()
  if (email.length > 254 || !EMAIL_RE.test(email)) return fail(400, 'invalid_email', 'that email address does not look right')
  const marketingOptIn = truthy(body.marketingOptIn)

  const live = await loadLive(ctx, id)
  if (live === 'gone') return fail(410, 'expired', 'this photo has expired')
  if (!live) return fail(404, 'not_found', 'photo not found')

  const now = ctx.clock.now(), rl = ctx.config.rateLimits, HOUR = 3_600_000
  if ((await ctx.db.hit(`email:ip:${clientIp(req)}`, HOUR, now)) > rl.emailPerIpPerHour ||
      (await ctx.db.hit(`email:session:${id}`, HOUR, now)) > rl.emailPerSessionPerHour) {
    return fail(429, 'rate_limited', 'too many tries, please wait a while', { 'retry-after': '3600' })
  }

  const emailNorm = email.toLowerCase()
  const emailHash = await hmacHex(ctx.config.signingSecret, `email:${emailNorm}`)
  const prev = await ctx.db.getOptin(id, emailHash)
  if (prev && now - prev.lastSentAt < rl.resendCooldownMs) return ok({ duplicate: true })

  await ctx.db.putOptin({
    id: prev?.id ?? newId(), sessionId: id, venueId: live.s.venueId,
    email: marketingOptIn ? emailNorm : null, // plaintext only kept if they opted in to marketing
    emailHash, consentVersion: ctx.config.consentVersion, consentAt: now, marketingOptIn, lastSentAt: now,
  })

  const base = baseUrl(ctx, req)
  const unsub = `${base}/u/${id}/${emailHash}?t=${await unsubToken(ctx.config.signingSecret, id, emailHash)}`
  const msg = renderEmail({ venueName: live.v.name, guestUrl: `${base}/g/${id}`, unsubscribeUrl: unsub, expiresText: formatDate(live.s.expiresAt) })
  try {
    await ctx.email.send({
      to: emailNorm, from: ctx.config.emailFrom, ...msg,
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
  } catch (e) {
    console.error('email send failed', e instanceof Error ? e.message : e)
    if (prev) await ctx.db.putOptin(prev); else await ctx.db.deleteOptin(id, emailHash)
    return fail(502, 'email_failed', 'could not send the email right now, please try again')
  }
  return ok()
}

async function unsubParams(ctx: AppContext, req: Request, id: string, hash: string) {
  const t = new URL(req.url).searchParams.get('t')
  return !!t && isValidId(id) && /^[0-9a-f]{64}$/.test(hash) && timingSafeEqual(t, await unsubToken(ctx.config.signingSecret, id, hash)) ? t : null
}
async function unsubPage(ctx: AppContext, req: Request, id: string, hash: string) {
  const t = await unsubParams(ctx, req, id, hash)
  if (!t) return msgPage(403, 'link not valid', '<p class="lead">that link is not valid.</p>')
  return msgPage(200, 'stop emails?',
    `<p class="lead">we will delete your email address and stop sending you anything.</p>
<form method="post" action="/u/${esc(id)}/${esc(hash)}?t=${esc(t)}"><button class="btn primary" type="submit">yes, remove my address</button></form>`)
}
async function unsubDo(ctx: AppContext, req: Request, id: string, hash: string) {
  if (!(await unsubParams(ctx, req, id, hash))) return msgPage(403, 'link not valid', '<p class="lead">that link is not valid.</p>')
  await ctx.db.deleteOptin(id, hash)
  return msgPage(200, 'done', '<p class="lead">your email address has been removed.</p>')
}

// ---------- staff: export & purge ----------
async function optinsCsv(ctx: AppContext, req: Request, venueId: string) {
  const venue = await ctx.db.getVenue(venueId)
  if (!venue || !(await adminOk(ctx, req, venue))) return err(401, 'unauthorized')
  const rows = (await ctx.db.listMarketingOptins(venueId)).map((o) => [
    o.email ?? '', o.venueId, o.sessionId, o.consentVersion, new Date(o.consentAt).toISOString(), o.marketingOptIn,
  ])
  const csv = toCsv(['email', 'venue_id', 'session_id', 'consent_version', 'consent_at', 'marketing_opt_in'], rows)
  return new Response(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="optins-${venueId}.csv"`, 'cache-control': 'no-store' },
  })
}

async function purgeVenue(ctx: AppContext, req: Request, venueId: string) {
  const venue = await ctx.db.getVenue(venueId)
  if (!venue || !(await adminOk(ctx, req, venue))) return err(401, 'unauthorized')
  const body = await readBody(req)
  if (!body) return err(400, 'bad_json')
  let targets: SessionRow[]
  if (Array.isArray(body.sessionIds)) {
    targets = []
    for (const sid of body.sessionIds.map(String)) { const s = isValidId(sid) ? await ctx.db.getSession(sid) : null; if (s?.venueId === venueId) targets.push(s) }
  } else if (body.olderThanDays !== undefined) {
    const d = Number(body.olderThanDays)
    if (!Number.isFinite(d) || d < 0) return err(400, 'bad_olderThanDays')
    targets = await ctx.db.listSessionsByVenue(venueId, ctx.clock.now() - d * DAY_MS)
  } else if (truthy(body.all)) {
    targets = await ctx.db.listSessionsByVenue(venueId)
  } else return err(400, 'scope_required', 'pass sessionIds, olderThanDays, or all:true')
  for (const s of targets) await deleteSessionFully(ctx, s.id)
  return json(200, { ok: true, deleted: targets.length })
}
