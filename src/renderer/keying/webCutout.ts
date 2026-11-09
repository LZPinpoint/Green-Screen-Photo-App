// Main-thread client for webCutout.worker.ts (web demo only). Lazy: the worker, ort-web, the wasm and the model are only
// fetched when a cutout (or the early warm-up) is first asked for.
import { aiStatus } from './aiBridge'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { res(v: string | undefined): void; rej(e: Error): void }>()
let loading = 0

function get(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./webCutout.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = e => {
    const d = e.data as { type?: string; state?: string; id?: number; ok?: boolean; result?: string; error?: string }
    if (d.type === 'status') { aiStatus.setLoading(d.state === 'loading'); return }
    const p = pending.get(d.id!); if (!p) return
    pending.delete(d.id!)
    if (d.ok) p.res(d.result); else p.rej(new Error(d.error))
  }
  w.onerror = () => { for (const p of pending.values()) p.rej(new Error('the ai worker crashed')); pending.clear(); worker = null; aiStatus.setLoading(false) }
  worker = w
  return w
}
const root = () => new URL('./', document.baseURI).href

function call(msg: Record<string, unknown>): Promise<string | undefined> {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    try { get().postMessage({ id, root: root(), ...msg }) } catch (e) { pending.delete(id); rej(e as Error) }
  })
}

/** person cutout of a data url -> PNG data url with alpha */
export async function webCutout(dataUrl: string): Promise<string> {
  loading++
  try { return (await call({ op: 'cutout', url: dataUrl, maxDim: 1600 }))! } finally { loading-- }
}
/** start downloading/compiling the model in the background */
export function webWarm(): void { void call({ op: 'warm' }).catch(() => {}) }
