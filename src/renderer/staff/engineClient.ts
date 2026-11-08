// Talks to the image worker; falls back to running engine.ts on the main thread if workers are unavailable.
import { handle } from './engine'

export interface Engine {
  call<T = unknown>(op: string, msg: unknown, transfer?: Transferable[]): Promise<T>
  readonly mode: 'worker' | 'main'
}

let shared: Promise<Engine> | null = null

function mainEngine(): Engine {
  return { mode: 'main', call: <T,>(op: string, msg: unknown) => handle(op, msg) as Promise<T> }
}

function workerEngine(): Engine | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  let w: Worker
  try { w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }) } catch { return null }
  let seq = 0
  const pending = new Map<number, { res(v: unknown): void; rej(e: Error): void }>()
  w.onmessage = e => {
    const { id, ok, result, error } = e.data as { id: number; ok: boolean; result?: unknown; error?: string }
    const p = pending.get(id); if (!p) return
    pending.delete(id)
    if (ok) p.res(result); else p.rej(new Error(error))
  }
  w.onerror = () => { for (const p of pending.values()) p.rej(new Error('image worker crashed')); pending.clear(); shared = null }
  return {
    mode: 'worker',
    call<T,>(op: string, msg: unknown, transfer: Transferable[] = []) {
      return new Promise<T>((res, rej) => {
        const id = ++seq
        pending.set(id, { res: res as (v: unknown) => void, rej })
        try { w.postMessage({ id, op, msg }, transfer) } catch (e) { pending.delete(id); rej(e as Error) }
      })
    }
  }
}

/** the shared engine (worker preferred). `logo` is sent once so print sheets can carry it. */
export function getEngine(logo?: { data: Uint8ClampedArray; width: number; height: number }): Promise<Engine> {
  if (shared) {
    // someone else (e.g. the demo's gallery thumbnailer) may have started it logo-less: hand the logo over when it arrives
    if (logo) shared = shared.then(async e => { await e.call('init', { logo }); return e })
    return shared
  }
  shared = (async () => {
    let eng = workerEngine()
    if (eng) {
      try { await Promise.race([eng.call('init', { logo }), new Promise((_, rej) => setTimeout(() => rej(new Error('worker timeout')), 5000))]) }
      catch { eng = null }
    }
    if (!eng) { eng = mainEngine(); await eng.call('init', { logo }) }
    return eng
  })()
  return shared
}
