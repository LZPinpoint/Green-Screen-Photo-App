import { describe, it, expect } from 'vitest'
import { qrMatrix } from '../../src/core'

// Minimal independent decoder for versions 1-2 (single RS block), to verify the generator end to end.
function decode(m: boolean[][]): { text: string; ecc: 'L' | 'M'; mask: number } {
  const n = m.length
  const ver = (n - 17) / 4
  // format info (copy 1)
  let f = 0
  const pos: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  pos.forEach(([x, y], i) => { if (m[y][x]) f |= 1 << i })
  f ^= 0x5412
  const eccBits = (f >> 13) & 3, mask = (f >> 10) & 7
  const ecc = eccBits === 1 ? 'L' : 'M'
  const fn = Array.from({ length: n }, () => new Array(n).fill(false))
  const box = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < n && y < n) fn[y][x] = true }
  box(0, 0, 8, 8); box(n - 8, 0, n - 1, 8); box(0, n - 8, 8, n - 1)
  for (let i = 0; i < n; i++) { fn[6][i] = true; fn[i][6] = true }
  if (ver === 2) box(16, 16, 20, 20)
  const bits: number[] = []
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - v : v
      if (fn[y][x]) continue
      const masks = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x * y) % 2 + (x * y) % 3 === 0, ((x * y) % 2 + (x * y) % 3) % 2 === 0, ((x + y) % 2 + (x * y) % 3) % 2 === 0]
      bits.push(m[y][x] !== masks[mask] ? 1 : 0)
    }
  }
  const cw: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const table: Record<string, number[][]> = { L: [[19, 7], [34, 10]], M: [[16, 10], [28, 16]] }
  const [dataLen, eccLen] = table[ecc][ver - 1]
  const all = cw.slice(0, dataLen + eccLen)
  // RS syndrome check over GF(256)
  const exp: number[] = [], log: number[] = []
  let x = 1
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11d }
  for (let s = 0; s < eccLen; s++) {
    let acc = 0
    for (const c of all) acc = (acc ? exp[(log[acc] + s) % 255] : 0) ^ c
    expect(acc).toBe(0)
  }
  const bs = all.slice(0, dataLen).map((c) => c.toString(2).padStart(8, '0')).join('')
  expect(bs.slice(0, 4)).toBe('0100')
  const len = parseInt(bs.slice(4, 12), 2)
  const bytes: number[] = []
  for (let i = 0; i < len; i++) bytes.push(parseInt(bs.slice(12 + i * 8, 20 + i * 8), 2))
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), ecc, mask }
}

describe('qrMatrix', () => {
  it('sizes follow version', () => {
    expect(qrMatrix('HELLO').length).toBe(21)
    expect(qrMatrix('x'.repeat(170)).length).toBeGreaterThan(41)
  })
  it('has finder patterns and dark module', () => {
    const m = qrMatrix('HELLO'); const n = m.length
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      expect(m[oy][ox]).toBe(true); expect(m[oy + 3][ox + 3]).toBe(true); expect(m[oy + 1][ox + 1]).toBe(false)
    }
    expect(m[n - 8][8]).toBe(true)
  })
  it('round-trips through an independent decoder (v1 + v2, ECC L/M)', () => {
    for (const t of ['HELLO', 'Hello, world!', 'https://x.io/a1']) {
      for (const e of ['L', 'M'] as const) {
        const d = decode(qrMatrix(t, e))
        expect(d.text).toBe(t)
      }
    }
  })
  it('known vector: v1-M "HELLO" has format bits for mask chosen and valid EC (decoded), ECC M default', () => {
    const d = decode(qrMatrix('HELLO'))
    expect(d.ecc).toBe('M'); expect(d.text).toBe('HELLO')
  })
  it('handles up to version 10 and throws beyond', () => {
    expect(qrMatrix('a'.repeat(213)).length).toBe(57) // version 10-L fallback
    expect(() => qrMatrix('a'.repeat(400))).toThrow()
  })
})
