import { describe, expect, it } from 'vitest'
import { DEFAULT_KEY, type KeyParams } from '../../src/shared/types'
import { analyzeBackdrop, chooseKeyer, greenBorderFraction, keyFrame, needsAiHint, type Px } from '../../src/renderer/keying/autoKey'

const W = 160, H = 240
function frame(bg: [number, number, number], person: [number, number, number] = [200, 140, 120]): Px {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const inPerson = Math.hypot((x - W / 2) / 40, (y - H * 0.55) / 80) < 1
    const c = inPerson ? person : bg
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255
  }
  return { data, width: W, height: H }
}
const greenFrame = () => frame([0, 177, 64])
const wallFrame = () => frame([205, 200, 190])   // beige room, no green anywhere
const key = (mode: KeyParams['mode']): KeyParams => ({ ...DEFAULT_KEY, mode })
/** fake ai: person-shaped alpha on the same pixels */
const fakeAi = (img: Px): Promise<Px> => {
  const out = new Uint8ClampedArray(img.data)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    out[(y * img.width + x) * 4 + 3] = Math.hypot((x - img.width / 2) / 40, (y - img.height * 0.55) / 80) < 1 ? 255 : 0
  }
  return Promise.resolve({ data: out, width: img.width, height: img.height })
}

describe('green backdrop detection', () => {
  it('sees the screen on a green frame and not on a beige room', () => {
    expect(greenBorderFraction(greenFrame(), DEFAULT_KEY)).toBeGreaterThan(0.9)
    expect(greenBorderFraction(wallFrame(), DEFAULT_KEY)).toBeLessThan(0.02)
  })
  it('a green-ish wall that is not the key colour does not count (blue/grey/white walls)', () => {
    expect(greenBorderFraction(frame([90, 110, 160]), DEFAULT_KEY)).toBe(0)
    expect(greenBorderFraction(frame([255, 255, 255]), DEFAULT_KEY)).toBe(0)
  })
  it('analyze reports a healthy key on green and a useless one on the wall', () => {
    const g = analyzeBackdrop(greenFrame(), DEFAULT_KEY)
    expect(g.poor).toBe(false); expect(g.coverage).toBeGreaterThan(0.5)
    const w = analyzeBackdrop(wallFrame(), DEFAULT_KEY)
    expect(w.greenBorderFrac).toBeLessThan(0.15); expect(w.poor).toBe(true)
  })
})

describe('chooseKeyer', () => {
  it('chroma and ai modes are fixed', () => {
    expect(chooseKeyer('chroma', { greenBorderFrac: 0, poor: true }).engine).toBe('chroma')
    expect(chooseKeyer('ai', { greenBorderFrac: 1, poor: false }).engine).toBe('ai')
  })
  it('auto: green + good -> chroma; no green -> ai; green but poor -> ai; unknown -> chroma', () => {
    expect(chooseKeyer('auto', { greenBorderFrac: 0.8, poor: false }).engine).toBe('chroma')
    expect(chooseKeyer('auto', { greenBorderFrac: 0.05, poor: false }).engine).toBe('ai')
    expect(chooseKeyer('auto', { greenBorderFrac: 0.8, poor: true }).engine).toBe('ai')
    expect(chooseKeyer('auto').engine).toBe('chroma')
  })
  it('live hint only when there is no green and the mode can fall back to ai', () => {
    expect(needsAiHint('auto', { greenBorderFrac: 0.02 })).toBe(true)
    expect(needsAiHint('ai', { greenBorderFrac: 0.02 })).toBe(true)
    expect(needsAiHint('chroma', { greenBorderFrac: 0.02 })).toBe(false)
    expect(needsAiHint('auto', { greenBorderFrac: 0.7 })).toBe(false)
    expect(needsAiHint('auto', undefined)).toBe(false)
  })
})

describe('keyFrame', () => {
  it('green-screen frame in auto mode uses chroma and never calls ai', async () => {
    let calls = 0
    const r = await keyFrame(greenFrame(), key('auto'), { ai: img => { calls++; return fakeAi(img) } })
    expect(r.engineUsed).toBe('chroma'); expect(calls).toBe(0)
    expect(r.image.data[3]).toBe(0)                    // corner (screen) is transparent
  })
  it('non-green frame in auto mode falls back to ai', async () => {
    const r = await keyFrame(wallFrame(), key('auto'), { ai: fakeAi })
    expect(r.engineUsed).toBe('ai'); expect(r.reason).toMatch(/no green screen/)
    expect(r.image.data[3]).toBe(0)                    // wall removed
    const mid = ((Math.floor(H * 0.55)) * W + W / 2) * 4 + 3
    expect(r.image.data[mid]).toBe(255)                // person kept
  })
  it('chroma mode never uses ai, ai mode never uses chroma', async () => {
    let calls = 0
    const ai = (img: Px) => { calls++; return fakeAi(img) }
    expect((await keyFrame(wallFrame(), key('chroma'), { ai })).engineUsed).toBe('chroma'); expect(calls).toBe(0)
    expect((await keyFrame(greenFrame(), key('ai'), { ai })).engineUsed).toBe('ai'); expect(calls).toBe(1)
  })
  it('ai throws -> chroma result + a reason, no exception', async () => {
    const r = await keyFrame(wallFrame(), key('auto'), { ai: () => Promise.reject(new Error('model missing')) })
    expect(r.engineUsed).toBe('chroma'); expect(r.reason).toMatch(/model missing/)
    expect(r.image.width).toBe(W)
  })
  it('ai not available at all -> chroma + reason', async () => {
    const r = await keyFrame(wallFrame(), key('ai'), {})
    expect(r.engineUsed).toBe('chroma'); expect(r.reason).toMatch(/not available/)
  })
  it('ai that never answers is cut off by the time box', async () => {
    const t = Date.now()
    const r = await keyFrame(wallFrame(), key('auto'), { ai: () => new Promise<Px>(() => {}), aiTimeoutMs: 60 })
    expect(Date.now() - t).toBeLessThan(1500)
    expect(r.engineUsed).toBe('chroma'); expect(r.reason).toMatch(/longer than/)
  })
  it('ai that finds nobody (all transparent) or returns the wrong size falls back', async () => {
    const empty = (img: Px) => Promise.resolve({ data: new Uint8ClampedArray(img.data.length), width: img.width, height: img.height })
    expect((await keyFrame(wallFrame(), key('auto'), { ai: empty })).reason).toMatch(/could not find a person/)
    const small = () => Promise.resolve({ data: new Uint8ClampedArray(16), width: 2, height: 2 })
    expect((await keyFrame(wallFrame(), key('auto'), { ai: small })).engineUsed).toBe('chroma')
  })
  it('accepts a data url through the decoder, and survives a decoder failure', async () => {
    const ok = await keyFrame('data:x', key('auto'), { decode: async () => wallFrame(), ai: fakeAi })
    expect(ok.engineUsed).toBe('ai')
    const bad = await keyFrame('data:x', key('auto'), { decode: async () => { throw new Error('bad jpeg') } })
    expect(bad.reason).toMatch(/bad jpeg/)
  })
})

import { dropIslands, refineMatte } from '../../src/renderer/keying/matte'
describe('matte refinement', () => {
  it('keeps the big person blob, drops a small speck, keeps a second big person', () => {
    const w = 40, h = 40, m = new Float32Array(w * h)
    const box = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1 }
    box(2, 5, 16, 38); box(24, 8, 38, 38); box(20, 2, 22, 4)
    dropIslands(m, w, h)
    expect(m[20 * w + 8]).toBe(1); expect(m[20 * w + 30]).toBe(1); expect(m[3 * w + 21]).toBe(0)
  })
  it('refine maps 0..1 to a crisp but soft edge', () => {
    const raw = new Float32Array(100).map((_, i) => i / 99)
    const r = refineMatte(raw, 10, 10)
    expect(r[0]).toBe(0); expect(r[99]).toBe(1)
    expect(r[50]).toBeGreaterThan(0.3); expect(r[50]).toBeLessThan(0.7)
  })
})
