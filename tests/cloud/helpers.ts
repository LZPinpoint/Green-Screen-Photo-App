import { handle } from '../../cloud/src/app'
import { DEFAULT_CONFIG } from '../../cloud/src/app'
import { FakeClock, MemoryBlobStore, MemoryDb } from '../../cloud/src/adapters/memory'
import { LogEmailProvider } from '../../cloud/src/email/providers'
import type { AppContext, Db } from '../../cloud/src/types'

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
export const ADMIN = 'admin-test-key'

export function makeApp(over: { db?: Db } = {}) {
  const clock = new FakeClock()
  const email = new LogEmailProvider(() => {})
  const ctx: AppContext = {
    blobs: new MemoryBlobStore(), db: over.db ?? new MemoryDb(), email, clock,
    config: { ...DEFAULT_CONFIG, signingSecret: 'test-signing-secret-1234', adminKey: ADMIN, baseUrl: 'https://photos.test' },
  }
  const call = (method: string, path: string, init: { headers?: Record<string, string>; body?: any; json?: unknown } = {}) =>
    handle(ctx, new Request('https://photos.test' + path, {
      method, headers: { ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    }))
  return { ctx, clock, email, call }
}
export type App = ReturnType<typeof makeApp>

export async function seedVenue(app: App, id = 'demo', extra: Record<string, unknown> = {}) {
  const r = await app.call('PUT', `/api/v1/venues/${id}`, { headers: { authorization: `Bearer ${ADMIN}` }, json: { name: 'Science Museum', welcomeText: 'Welcome to the dino hall', ...extra } })
  const j = await r.json()
  return { venueId: id, apiKey: j.apiKey as string, adminKey: j.adminKey as string, status: r.status }
}
export const auth = (k: string) => ({ authorization: `Bearer ${k}` })

export async function createSession(app: App, v: { venueId: string; apiKey: string }, extra: Record<string, unknown> = {}) {
  const r = await app.call('POST', '/api/v1/sessions', { headers: auth(v.apiKey), json: { venueId: v.venueId, createdAt: app.clock.now(), scene: 'dino', layout: 'classic', ...extra } })
  return { r, j: await r.json() }
}
export const putImage = (app: App, v: { apiKey: string }, id: string, bytes: Uint8Array, type = 'image/jpeg', kind = 'image') =>
  app.call('PUT', `/api/v1/sessions/${id}/${kind}`, { headers: { ...auth(v.apiKey), 'content-type': type }, body: bytes })
