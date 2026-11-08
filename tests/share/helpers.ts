import { handle } from '../../cloud/src/app'
import type { FetchLike } from '../../src/main/share'
import type { QueueFs } from '../../src/main/share'
import { makeApp, seedVenue, JPEG } from '../cloud/helpers'

export { JPEG }

export function memFs(files: Record<string, Uint8Array | string> = {}) {
  const m = new Map<string, Uint8Array | string>(Object.entries(files))
  const log: string[] = []
  const fs: QueueFs = {
    async readFile(p) { const v = m.get(p); if (v === undefined) throw Object.assign(new Error('ENOENT ' + p), { code: 'ENOENT' }); return typeof v === 'string' ? new TextEncoder().encode(v) : v },
    async readText(p) { const v = m.get(p); if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return typeof v === 'string' ? v : new TextDecoder().decode(v) },
    async writeText(p, d) { log.push('write ' + p); m.set(p, d) },
    async rename(a, b) { log.push(`rename ${a} ${b}`); m.set(b, m.get(a)!); m.delete(a) },
    async mkdir() {},
  }
  return { fs, m, log }
}

/** fetch implementation backed by the real cloud handlers (no sockets), with an on/off switch and call log. */
export async function backend() {
  const app = makeApp()
  const venue = await seedVenue(app)
  const calls: { method: string; path: string; status: number; body?: any }[] = []
  const state = { online: true, failNext: [] as (number | 'net')[] }
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url)
    const fail = state.failNext.shift()
    const rec = (status: number) => calls.push({ method: init?.method ?? 'GET', path: u.pathname, status, body: init?.body })
    if (!state.online || fail === 'net') { rec(0); throw new TypeError('fetch failed') }
    if (typeof fail === 'number') { rec(fail); return new Response(JSON.stringify({ error: 'injected' }), { status: fail }) as any }
    const res = await handle(app.ctx, new Request(url, { method: init?.method, headers: init?.headers, body: init?.body as any }))
    rec(res.status)
    return res as any
  }
  return { app, venue, calls, state, fetchImpl, baseUrl: 'https://photos.test' }
}
