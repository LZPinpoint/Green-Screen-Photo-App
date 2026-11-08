import { describe, it, expect } from 'vitest'
import { layoutSheet, PRINT_PX, qrMatrix } from '../../src/core'
import type { PrintLayout, PrintSize } from '../../src/shared/types'
import { solid, px } from './helpers'

const sizes: PrintSize[] = ['4x6', '5x7', '6x8', '2x6-strip']
const mk = (size: PrintSize, n: 1 | 2 | 3 | 4, extra: Partial<PrintLayout> = {}): PrintLayout =>
  ({ id: 'x', name: 'x', size, photosPerSheet: n, showLogo: false, qrCode: false, ...extra })

describe('layoutSheet', () => {
  it('PRINT_PX values', () => {
    expect(PRINT_PX['4x6']).toEqual({ w: 1200, h: 1800 })
    expect(PRINT_PX['5x7']).toEqual({ w: 1500, h: 2100 })
    expect(PRINT_PX['6x8']).toEqual({ w: 1800, h: 2400 })
    expect(PRINT_PX['2x6-strip']).toEqual({ w: 1200, h: 1800 })
  })
  const photo = solid(300, 400, [200, 30, 30, 255])
  for (const size of sizes) for (const n of [1, 2, 3, 4] as const) {
    it(`${size} x${n} has exact dimensions`, () => {
      const o = layoutSheet(mk(size, n), [photo])
      expect(o.width).toBe(PRINT_PX[size].w); expect(o.height).toBe(PRINT_PX[size].h)
      expect(o.data.length).toBe(o.width * o.height * 4)
      expect(px(o, 1, 1)).toEqual([255, 255, 255, 255]) // white margin
    })
  }
  it('1-up places photo in centre with white margins', () => {
    const o = layoutSheet(mk('4x6', 1), [photo])
    expect(px(o, 600, 900)).toEqual([200, 30, 30, 255])
    expect(px(o, 10, 900)).toEqual([255, 255, 255, 255])
  })
  it('4-up fills four cells with a white gutter', () => {
    const o = layoutSheet(mk('4x6', 4), [photo])
    for (const [x, y] of [[300, 450], [900, 450], [300, 1300], [900, 1300]]) expect(px(o, x, y)[1]).toBe(30)
    expect(px(o, 600, 450)).toEqual([255, 255, 255, 255])
  })
  it('strip sheet holds two identical strips', () => {
    const o = layoutSheet(mk('2x6-strip', 3), [photo])
    for (let y = 0; y < 1800; y += 37) for (let x = 0; x < 600; x += 29) {
      expect(px(o, x, y)).toEqual(px(o, x + 600, y))
    }
    expect(px(o, 300, 400)[1]).toBe(30)
  })
  it('draws QR in footer corner from a boolean matrix', () => {
    const qr = qrMatrix('https://example.com/a')
    const o = layoutSheet(mk('4x6', 1, { qrCode: true }), [photo], { qr })
    let dark = 0
    for (let y = 1500; y < 1800; y++) for (let x = 800; x < 1200; x++) if (px(o, x, y)[0] === 0) dark++
    expect(dark).toBeGreaterThan(300)
  })
  it('logo is drawn; text is skipped safely in node', () => {
    const logo = solid(100, 50, [0, 0, 255, 255])
    const o = layoutSheet(mk('4x6', 1, { showLogo: true, footerText: 'hello' }), [photo], { logo })
    let blue = 0
    for (let y = 1500; y < 1800; y++) for (let x = 0; x < 600; x++) if (px(o, x, y)[2] === 255 && px(o, x, y)[0] === 0) blue++
    expect(blue).toBeGreaterThan(500)
  })
})
