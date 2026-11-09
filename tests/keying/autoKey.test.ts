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

import { dropIslands, fillHoles, refineMatte } from '../../src/renderer/keying/matte'
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
    expect(r[20]).toBeGreaterThan(0.3); expect(r[50]).toBe(1)
  })
  it('fills small enclosed holes but not gaps open to the edge', () => {
    const w = 30, h = 30, m = new Float32Array(w * h).fill(1)
    m[10 * w + 10] = 0; m[11 * w + 10] = 0   // enclosed pinhole
    for (let y = 0; y < 10; y++) m[y * w + 0] = 0 // open to the edge
    fillHoles(m, w, h)
    expect(m[10 * w + 10]).toBe(1); expect(m[3 * w]).toBe(0)
  })
})

import { autoStage, effectiveKey, leftoverShare, stageGapSides, liveHint } from '../../src/renderer/keying/autoKey'

/** testers' phone frames: green screen only fills part of the picture; wall patch top-left, ceiling band on top, dark box bottom-right, skin subject in the middle */
function testerFrame(opts: { wallPatch?: boolean; ceiling?: boolean; box?: boolean } = { wallPatch: true, ceiling: true, box: true }): Px {
  const w = 180, h = 320
  const data = new Uint8ClampedArray(w * h * 4)
  const put = (x: number, y: number, c: number[]) => { const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255 }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = [8 + (x % 5), 177 - (y % 4), 64]                                  // green screen (a little noise)
    if (opts.ceiling && y < 28) c = [225, 222, 215]                           // ceiling / vent band, full width
    if (opts.wallPatch && x < 40 && y >= 28 && y < 80) c = [190, 175, 150]    // wall patch in the top-left corner
    if (opts.box && x >= 140 && y >= 250) c = [30, 28, 30]                    // dark box bottom-right
    if (Math.hypot((x - 90) / 38, (y - 190) / 90) < 1) c = [205, 150, 125]    // skin-coloured subject
    put(x, y, c)
  }
  return { data, width: w, height: h }
}
const alphaAt = (p: Px, x: number, y: number) => p.data[(y * p.width + x) * 4 + 3]
const AUTO: KeyParams = { ...DEFAULT_KEY, mode: 'auto' }

describe('autoStage', () => {
  it('trims the ceiling band, the wall-side and the box side; leaves a fully green frame alone', () => {
    expect(autoStage(greenFrame(), DEFAULT_KEY)).toBeUndefined()
    const st = autoStage(testerFrame({ ceiling: true }), DEFAULT_KEY)!
    expect(st.top).toBeGreaterThan(28 / 320); expect(st.left).toBe(0)
    expect(stageGapSides(st)).toEqual(['top'])
  })
  it('does not eat the subject at the bottom edge or the frame when there is no screen at all', () => {
    const f = frame([0, 177, 64], [205, 150, 125])
    expect(autoStage(f, DEFAULT_KEY)?.bottom ?? 0).toBeLessThan(0.05)
    expect(autoStage(wallFrame(), DEFAULT_KEY)).toBeUndefined()
  })
  it('only applies in auto mode and never overrides an explicit stage', () => {
    const f = testerFrame({ ceiling: true })
    expect(effectiveKey(f, { ...DEFAULT_KEY, mode: 'chroma' }).stage).toBeUndefined()
    expect(effectiveKey(f, AUTO).stage).toBeDefined()
    const mine = { left: 0.1, right: 0, top: 0, bottom: 0 }
    expect(effectiveKey(f, { ...AUTO, stage: mine }).stage).toBe(mine)
    expect(liveHint('auto', { greenBorderFrac: 0.9, gaps: ['top', 'left'] })).toMatch(/top and left/)
  })
})

describe('tester frames end to end (auto mode)', () => {
  const check = (r: { image: Px }) => {
    expect(alphaAt(r.image, 10, 5)).toBe(0)        // ceiling band
    expect(alphaAt(r.image, 100, 10)).toBe(0)
    expect(alphaAt(r.image, 15, 50)).toBe(0)       // wall patch top-left
    expect(alphaAt(r.image, 165, 285)).toBe(0)     // dark box bottom-right
    expect(alphaAt(r.image, 90, 190)).toBe(255)    // subject
    expect(alphaAt(r.image, 90, 150)).toBe(255)
  }
  it('chroma + autoStage alone clears a full-width ceiling band', async () => {
    const r = await keyFrame(testerFrame({ ceiling: true }), AUTO, {})
    expect(r.engineUsed).toBe('chroma')
    expect(alphaAt(r.image, 100, 10)).toBe(0); expect(alphaAt(r.image, 90, 190)).toBe(255)
  })
  it('all three leftovers + hybrid ai garbage matte -> clean', async () => {
    const f = testerFrame()
    // the ai sees only the person (slightly fattened)
    const ai = (img: Px) => { const o = new Uint8ClampedArray(img.data); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) o[(y * img.width + x) * 4 + 3] = Math.hypot((x - 90) / 40, (y - 190) / 95) < 1 ? 255 : 0; return Promise.resolve({ data: o, width: img.width, height: img.height }) }
    const r = await keyFrame(f, AUTO, { ai })
    expect(r.engineUsed).toBe('hybrid'); check(r)
  })
  it('wall patch alone (autoStage cannot trim a corner) triggers the hybrid and is removed; without ai it is reported', async () => {
    const f = testerFrame({ wallPatch: true })
    const keyed = (await keyFrame(f, AUTO, {})).image
    expect(leftoverShare(keyed.data, keyed.width, keyed.height)).toBeGreaterThan(0.015)
    const ai = (img: Px) => { const o = new Uint8ClampedArray(img.data); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) o[(y * img.width + x) * 4 + 3] = Math.hypot((x - 90) / 40, (y - 190) / 95) < 1 ? 255 : 0; return Promise.resolve({ data: o, width: img.width, height: img.height }) }
    const r = await keyFrame(f, AUTO, { ai })
    expect(r.engineUsed).toBe('hybrid'); expect(alphaAt(r.image, 15, 50)).toBe(0); expect(alphaAt(r.image, 90, 190)).toBe(255)
    const nok = await keyFrame(f, AUTO, { ai: () => Promise.reject(new Error('nope')) })
    expect(nok.engineUsed).toBe('chroma'); expect(nok.reason).toMatch(/nope/)
  })
  it('fast path: a screen that fills the frame never runs ai', async () => {
    let n = 0
    const r = await keyFrame(greenFrame(), AUTO, { ai: img => { n++; return Promise.resolve(img) } })
    expect(r.engineUsed).toBe('chroma'); expect(n).toBe(0)
  })
})
