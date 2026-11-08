import { describe, it, expect } from 'vitest'
import { composeScene } from '../../src/core'
import { solid, px } from './helpers'

describe('composeScene', () => {
  const scene = solid(300, 100, [20, 40, 200, 255]) // wide scene -> cover-fit crop
  const subject = solid(50, 100, [250, 10, 10, 255])
  const out = composeScene({ subject, scene, anchor: { x: 0.5, y: 0.9, scale: 0.5 }, outW: 200, outH: 400 })
  it('exact dimensions + cover fit fills canvas', () => {
    expect(out.width).toBe(200); expect(out.height).toBe(400)
    expect(px(out, 5, 5)).toEqual([20, 40, 200, 255])
    expect(px(out, 195, 5)[2]).toBeGreaterThan(190)
  })
  it('subject placed bottom-anchored and centred', () => {
    // subject height 200 -> top at 0.9*400-200=160, bottom 360, width 100 -> x 50..150
    expect(px(out, 100, 260)[0]).toBeGreaterThan(200)
    expect(px(out, 100, 340)[0]).toBeGreaterThan(200)
    expect(px(out, 100, 150)[0]).toBeLessThan(40)
    expect(px(out, 100, 375)[0]).toBeLessThan(40)
    expect(px(out, 30, 260)[0]).toBeLessThan(40)
    expect(px(out, 170, 260)[0]).toBeLessThan(40)
  })
  it('contact shadow darkens scene just below feet', () => {
    expect(px(out, 100, 366)[2]).toBeLessThan(195)
    expect(px(out, 100, 366)[2]).toBeGreaterThan(40)
  })
  it('alpha-over blends partial alpha', () => {
    const half = solid(50, 100, [255, 0, 0, 128])
    const o = composeScene({ subject: half, scene: solid(100, 100, [0, 0, 255, 255]), anchor: { x: 0.5, y: 1, scale: 1 }, outW: 100, outH: 100 })
    const [r, , b] = px(o, 50, 50)
    expect(r).toBeGreaterThan(100); expect(r).toBeLessThan(160)
    expect(b).toBeGreaterThan(90); expect(b).toBeLessThan(160)
  })
  it('transparent subject leaves scene unchanged away from shadow', () => {
    const o = composeScene({ subject: solid(10, 10, [0, 0, 0, 0]), scene: solid(40, 40, [9, 9, 9, 255]), anchor: { x: 0.5, y: 1, scale: 1 }, outW: 40, outH: 40 })
    expect(px(o, 20, 20)).toEqual([9, 9, 9, 255])
  })
  it('frame overlay drawn on top', () => {
    const frame = solid(10, 10, [0, 255, 0, 255])
    const o = composeScene({ subject, scene, anchor: { x: 0.5, y: 0.9, scale: 0.5 }, frame, outW: 200, outH: 400 })
    expect(px(o, 100, 260)).toEqual([0, 255, 0, 255])
  })
})
