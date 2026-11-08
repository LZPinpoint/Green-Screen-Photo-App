import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import sharp from 'sharp'

const dirs: string[] = []
export async function tmp(): Promise<string> { const d = await mkdtemp(join(tmpdir(), 'booth-test-')); dirs.push(d); return d }
export function cleanupTmp(): void { afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) }) }
export async function pngDataUrl(w = 600, h = 400, color = '#336699'): Promise<string> {
  const b = await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()
  return `data:image/png;base64,${b.toString('base64')}`
}
