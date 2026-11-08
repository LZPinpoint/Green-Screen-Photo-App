import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { CH } from '../../src/main/channels'
import { buildHandlers, registerIpc } from '../../src/main/ipc'
import { createServices } from '../../src/main/services'
import { AiCutout, chromaMatte, findModel } from '../../src/main/ai/cutout'
import { tmp, cleanupTmp, pngDataUrl } from './helpers'
cleanupTmp()

describe('ipc handlers', () => {
  it('every channel is booth:<area>:<fn>, all handled, round trip works', async () => {
    const d = await tmp()
    const sv = createServices({ dataDir: d, dslr: [] })
    try {
      const h = buildHandlers(sv)
      const chans = Object.values(CH).filter(c => c !== CH.printerStatus)
      for (const c of Object.values(CH)) expect(c).toMatch(/^booth:[a-z]+:[A-Za-z]+$/)
      expect(Object.keys(h).sort()).toEqual([...chans].sort())
      const s = await h[CH.sessionStart]() as { id: string }
      await h[CH.cameraConnect]('simulated:0')
      const shot = await h[CH.cameraCapture]() as string
      expect(shot).toMatch(/^data:image\/jpeg;base64,/)
      const s2 = await h[CH.sessionSaveShot](s.id, shot) as { shots: unknown[] }
      expect(s2.shots).toHaveLength(1)
      expect((await h[CH.cameraList]() as { id: string }[]).map(x => x.id)).toContain('simulated:0')
      expect((await h[CH.settingsSet]({ venueName: 'X' }) as { venueName: string }).venueName).toBe('X')
      const handlers: Record<string, unknown> = {}
      registerIpc({ handle: (c, f) => { handlers[c] = f } }, sv, () => undefined)
      expect(Object.keys(handlers)).toHaveLength(chans.length)
    } finally { sv.stopCleanup() }
  })
})

describe('ai cutout fallback', () => {
  it('findModel order', () => {
    expect(findModel(['/a', '/b'], undefined, p => p === '/b/u2netp.onnx')).toBe('/b/u2netp.onnx')
    expect(findModel(['/a'], '/env.onnx', p => p === '/env.onnx')).toBe('/env.onnx')
    expect(findModel(['/a'], undefined, () => false)).toBeUndefined()
  })
  it('chromaMatte keys green from person-colored block', () => {
    const w = 40, h = 40, px = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, fg = x > 12 && x < 28 && y > 10
      px[i] = fg ? 180 : 0; px[i + 1] = fg ? 40 : 177; px[i + 2] = fg ? 60 : 64; px[i + 3] = 255
    }
    const a = chromaMatte(px, w, h, 4)
    expect(a[2 * w + 2]).toBe(0); expect(a[25 * w + 20]).toBe(255)
  })
  it('cutout without model returns PNG with alpha', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#00b140"/><circle cx="100" cy="110" r="50" fill="#b80021"/></svg>'
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const out = await new AiCutout([await tmp()]).cutout(`data:image/png;base64,${png.toString('base64')}`)
    const { data, info } = await sharp(Buffer.from(out.split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    expect(data[(5 * 200 + 5) * 4 + 3]).toBe(0); expect(data[(110 * 200 + 100) * 4 + 3]).toBe(255)
    void pngDataUrl
  })
  it('cutout with the bundled u2netp model produces a valid PNG (if model present)', async () => {
    const { existsSync } = await import('node:fs')
    const dir = new URL('../../resources/models', import.meta.url).pathname
    if (!existsSync(`${dir}/u2netp.onnx`)) return
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#00b140"/><circle cx="160" cy="170" r="90" fill="#b80021"/></svg>'
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const out = await new AiCutout([dir]).cutout(`data:image/png;base64,${png.toString('base64')}`)
    const { data, info } = await sharp(Buffer.from(out.split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height, info.channels]).toEqual([320, 320, 4])
    const alphas = new Set<number>(); for (let i = 3; i < data.length; i += 4 * 97) alphas.add(data[i] > 127 ? 1 : 0)
    expect(alphas.size).toBe(2) // model produced both fg and bg
  })
})
