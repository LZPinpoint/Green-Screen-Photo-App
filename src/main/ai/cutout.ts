import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { ImageData64 } from '@shared/types'
import { log } from '../logger'
import { parseDataUrl, toDataUrl } from '../util'

/**
 * AI cutout. LICENSE: uses onnxruntime-node (MIT) + a permissive model (u2netp / U2-Net: Apache-2.0, or MODNet: Apache-2.0).
 * Do NOT use @imgly/background-removal-node (AGPL).
 *
 * Model file lookup order (first hit wins):
 *   $BOOTH_CUTOUT_MODEL, <userData>/models/{modnet,u2net,u2netp}.onnx, <resources>/models/{...}.onnx
 * If none loads (or inference throws) we fall back to a sharp-based chroma/saliency matte.
 */
export const MODEL_FILES = ['modnet.onnx', 'u2net.onnx', 'u2netp.onnx']

export function findModel(dirs: string[], env: string | undefined = process.env.BOOTH_CUTOUT_MODEL, exists: (p: string) => boolean = existsSync): string | undefined {
  if (env && exists(env)) return env
  for (const d of dirs) for (const f of MODEL_FILES) { const p = join(d, f); if (exists(p)) return p }
  return undefined
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

/** Pure fallback matte: background colour = median of the image border; alpha from colour distance (green-biased). raw RGBA in, alpha plane out. */
export function chromaMatte(rgb: Uint8Array | Buffer, w: number, h: number, channels: number): Uint8Array {
  const samples: number[][] = [[], [], []]
  const take = (x: number, y: number) => { const i = (y * w + x) * channels; for (let c = 0; c < 3; c++) samples[c].push(rgb[i + c]) }
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.04))
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) if (x < bw || y < bw || x >= w - bw || y >= h - bw) take(x, y)
  const med = samples.map(a => { a.sort((p, q) => p - q); return a[a.length >> 1] ?? 0 })
  const alpha = new Uint8Array(w * h)
  for (let p = 0, i = 0; p < w * h; p++, i += channels) {
    const dr = rgb[i] - med[0], dg = rgb[i + 1] - med[1], db = rgb[i + 2] - med[2]
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67
    // extra credit for "greener than red/blue" pixels (typical screen) so shadows on the screen still drop out
    const greenness = (rgb[i + 1] - Math.max(rgb[i], rgb[i + 2])) / 255
    const d = dist + (greenness < 0.05 ? 0.1 : -Math.min(0.2, greenness * 0.5))
    alpha[p] = Math.round(255 * smooth(0.12, 0.3, d))
  }
  return alpha
}

type OrtSession = { run(f: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>; inputNames: readonly string[]; outputNames: readonly string[] }
type OrtModule = { InferenceSession: { create(p: string, o?: unknown): Promise<OrtSession> }; Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown }

export class AiCutout {
  private session?: Promise<{ s: OrtSession; ort: OrtModule; modnet: boolean } | undefined>
  constructor(private readonly modelDirs: string[]) {}

  private load() {
    return (this.session ??= (async () => {
      const path = findModel(this.modelDirs)
      if (!path) { log.warn('ai.cutout: no ONNX model found; using chroma fallback. See docs/HARDWARE.md (AI cutout model).'); return undefined }
      try {
        const ort = (await import('onnxruntime-node')) as unknown as OrtModule
        const s = await ort.InferenceSession.create(path, { executionProviders: ['cpu'] })
        log.info('ai.cutout: loaded model', path)
        return { s, ort, modnet: /modnet/i.test(path) }
      } catch (e) { log.error('ai.cutout: model failed to load, using fallback', e); return undefined }
    })())
  }

  /** Returns a PNG data URL with alpha. */
  async cutout(dataUrl: ImageData64): Promise<ImageData64> {
    const { buf } = parseDataUrl(dataUrl)
    const base = sharp(buf).rotate()
    const { data, info } = await base.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let alpha: Uint8Array | undefined
    const m = await this.load()
    if (m) { try { alpha = await this.infer(m, buf, info.width, info.height) } catch (e) { log.error('ai.cutout: inference failed, using fallback', e) } }
    if (!alpha) alpha = chromaMatte(data, info.width, info.height, 4)
    const out = Buffer.from(data)
    for (let p = 0; p < info.width * info.height; p++) out[p * 4 + 3] = alpha[p]
    const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
    return toDataUrl(png, 'image/png')
  }

  private async infer(m: { s: OrtSession; ort: OrtModule; modnet: boolean }, buf: Buffer, w: number, h: number): Promise<Uint8Array> {
    const N = m.modnet ? 512 : 320
    const px = await sharp(buf).rotate().removeAlpha().resize(N, N, { fit: 'fill' }).raw().toBuffer()
    const plane = N * N
    const input = new Float32Array(3 * plane)
    if (m.modnet) {
      for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (px[i * 3 + c] / 255 - 0.5) / 0.5
    } else {
      const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]
      let max = 1; for (let i = 0; i < px.length; i++) if (px[i] > max) max = px[i]
      for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (px[i * 3 + c] / max - mean[c]) / std[c]
    }
    const tensor = new m.ort.Tensor('float32', input, [1, 3, N, N])
    const res = await m.s.run({ [m.s.inputNames[0]]: tensor })
    const out = res[m.s.outputNames[0]].data
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < plane; i++) { if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i] }
    const a8 = Buffer.alloc(plane)
    const range = hi - lo || 1
    for (let i = 0; i < plane; i++) a8[i] = Math.round(255 * (m.modnet ? Math.min(1, Math.max(0, out[i])) : (out[i] - lo) / range))
    const full = await sharp(a8, { raw: { width: N, height: N, channels: 1 } }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer()
    return full
  }
}
