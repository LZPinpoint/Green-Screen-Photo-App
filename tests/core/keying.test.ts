import { describe, it, expect } from 'vitest'
import { chromaKey, autoCalibrate, keyQuality } from '../../src/core'
import { DEFAULT_KEY } from '../../src/shared/types'
import { synth, px, GREEN } from './helpers'

const P = { ...DEFAULT_KEY, keyColor: GREEN }

describe('chromaKey', () => {
  const s = synth(400, 300)
  const out = chromaKey(s.img, P)
  it('keeps shape', () => {
    expect(out.width).toBe(400); expect(out.height).toBe(300)
    expect(out.data.length).toBe(400 * 300 * 4)
  })
  it('background alpha ~ 0', () => {
    for (const [x, y] of [[5, 5], [390, 10], [20, 290], [300, 150]]) expect(px(out, x, y)[3]).toBeLessThan(5)
  })
  it('subject alpha ~ 255 incl. near-green clothing', () => {
    expect(px(out, s.cx, s.cy)[3]).toBeGreaterThan(250)
    expect(px(out, 200, 240)[3]).toBeGreaterThan(250)
  })
  it('soft edge yields partial alpha somewhere', () => {
    let semi = 0
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 20 && out.data[i] < 235) semi++
    expect(semi).toBeGreaterThan(0)
  })
  it('spill reduced', () => {
    const [x, y] = [s.spill.x0 + 5, s.spill.y0 + 5]
    const before = px(s.img, x, y), after = px(out, x, y)
    const ex = (p: number[]) => p[1] - Math.max(p[0], p[2])
    expect(ex(before)).toBeGreaterThan(30)
    expect(ex(after)).toBeLessThan(ex(before) * 0.25)
    expect(after[3]).toBeGreaterThan(250)
  })
  it('edge shrink erodes the matte', () => {
    const a = (r: number) => { const o = chromaKey(s.img, { ...P, edgeShrink: r }); let n = 0; for (let i = 3; i < o.data.length; i += 4) n += o.data[i]; return n }
    expect(a(3)).toBeLessThan(a(0))
  })
  it('removes isolated specks and fills tiny holes', () => {
    const t = synth(400, 300)
    const set = (x: number, y: number, c: number[]) => { const j = (y * 400 + x) * 4; t.img.data[j] = c[0]; t.img.data[j + 1] = c[1]; t.img.data[j + 2] = c[2] }
    for (let y = 20; y < 23; y++) for (let x = 20; x < 23; x++) set(x, y, [224, 172, 140]) // speck in bg
    for (let y = 100; y < 102; y++) for (let x = 200; x < 202; x++) set(x, y, [0, 177, 64]) // hole in face
    const o = chromaKey(t.img, { ...P, edgeShrink: 0 })
    expect(px(o, 21, 21)[3]).toBe(0)
    expect(px(o, 200, 100)[3]).toBe(255)
  })
  it('does not mutate input', () => {
    const c = synth(40, 30); const copy = new Uint8ClampedArray(c.img.data)
    chromaKey(c.img, P)
    expect(c.img.data).toEqual(copy)
  })
})

describe('autoCalibrate / keyQuality', () => {
  it('finds the green', () => {
    const s = synth(400, 300)
    const [r, g, b] = autoCalibrate(s.img)
    expect(Math.abs(r - 0)).toBeLessThan(6); expect(Math.abs(g - 177)).toBeLessThan(6); expect(Math.abs(b - 64)).toBeLessThan(6)
  })
  it('falls back on non-green image', () => {
    expect(autoCalibrate({ data: new Uint8ClampedArray(16 * 16 * 4).fill(128), width: 16, height: 16 })).toEqual([0, 177, 64])
  })
  it('good key is ok, bad key has tips', () => {
    const s = synth(400, 300)
    const good = keyQuality(s.img, { ...P, smoothness: 0.2 })
    expect(good.coverage).toBeGreaterThan(0.5)
    const bad = keyQuality(s.img, { ...P, keyColor: [200, 40, 40] })
    expect(bad.ok).toBe(false)
    expect(bad.tips.length).toBeGreaterThan(0)
    expect(typeof bad.tips[0]).toBe('string')
  })
})

describe('performance', () => {
  it('keys 1920x1280 in < 400ms', () => {
    const s = synth(1920, 1280)
    chromaKey(synth(200, 150).img, P) // warm up
    const t = performance.now()
    chromaKey(s.img, P)
    const ms = performance.now() - t
    console.log('key 1920x1280 ms', Math.round(ms))
    expect(ms).toBeLessThan(400)
  })
})

describe('stage (garbage matte)', () => {
  // a frame whose left third is NOT green (a wall the camera sees past the screen edge) and the rest is green
  const W = 60, H = 40
  const wall = (x: number) => x < 20
  const img = () => {
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4
      if (wall(x)) { d[j] = 170; d[j + 1] = 165; d[j + 2] = 160 } else { d[j] = 0; d[j + 1] = 177; d[j + 2] = 64 }
      d[j + 3] = 255
    }
    return { data: d, width: W, height: H }
  }
  const alphaAt = (o: { data: Uint8ClampedArray }, x: number, y: number) => o.data[(y * W + x) * 4 + 3]
  it('without a stage the wall survives; with the stage it is removed', async () => {
    const { chromaKey } = await import('../../src/core/keying/chromaKey')
    const { DEFAULT_KEY } = await import('../../src/shared/types')
    const base = chromaKey(img(), { ...DEFAULT_KEY, edgeShrink: 0 })
    expect(alphaAt(base, 5, 20)).toBeGreaterThan(200) // wall kept (bug the testers saw)
    const staged = chromaKey(img(), { ...DEFAULT_KEY, edgeShrink: 0, stage: { left: 0.4, right: 0, top: 0, bottom: 0 } })
    expect(alphaAt(staged, 5, 20)).toBe(0)
    expect(alphaAt(staged, 45, 20)).toBe(0) // green still keyed out
  })
  it('clamps absurd values and ignores NaN', async () => {
    const { applyStage } = await import('../../src/core/keying/chromaKey')
    const a = new Uint8Array(100 * 100).fill(255)
    applyStage(a, 100, 100, { left: 5, right: Number.NaN, top: -1, bottom: 0 })
    expect(a[50 * 100 + 44]).toBe(0)   // left clamped to 45%
    expect(a[50 * 100 + 46]).toBe(255) // centre kept
  })
})
