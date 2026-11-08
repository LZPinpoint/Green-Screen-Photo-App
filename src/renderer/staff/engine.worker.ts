// Web Worker host for engine.ts (see there).
import { handle } from './engine'

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void }
ctx.onmessage = async (e: MessageEvent) => {
  const { id, op, msg } = e.data as { id: number; op: string; msg: unknown }
  try { ctx.postMessage({ id, ok: true, result: await handle(op, msg) }) }
  catch (err) { ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }) }
}
