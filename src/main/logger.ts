import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logDir: string | undefined
export function initLogger(dir: string): void {
  logDir = dir
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
}
function write(level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${args.map(a => a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : safeJson(a)).join(' ')}\n`
  if (level === 'error') console.error(line.trimEnd()); else console.log(line.trimEnd())
  if (!logDir) return
  try { appendFileSync(join(logDir, `booth-${new Date().toISOString().slice(0, 10)}.log`), line) } catch { /* never throw from logger */ }
}
function safeJson(v: unknown): string { try { return JSON.stringify(v) } catch { return String(v) } }
export const log = {
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a)
}
