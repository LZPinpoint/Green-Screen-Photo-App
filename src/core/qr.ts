// Self-contained QR code generator: byte mode, ECC L/M, versions 1..10.

type Ecc = 'L' | 'M'

// [ecc codewords per block, blocks in group1, data cw group1, blocks group2, data cw group2]
const TABLE: Record<Ecc, number[][]> = {
  L: [[7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  M: [[10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
}
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

// GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256)
;(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] })()
const gmul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0)

function rsGenerator(deg: number): number[] {
  let g = [1]
  for (let i = 0; i < deg; i++) {
    const next = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]) }
    g = next
  }
  return g
}
function rsEncode(data: number[], deg: number): number[] {
  const gen = rsGenerator(deg)
  const res = new Array(deg).fill(0)
  for (const d of data) {
    const f = d ^ res.shift()!
    res.push(0)
    if (f) for (let i = 0; i < deg; i++) res[i] ^= gmul(gen[i + 1], f)
  }
  return res
}

function utf8(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

function formatBits(ecc: Ecc, mask: number): number {
  const data = ((ecc === 'L' ? 1 : 0) << 3) | mask // L=01, M=00
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}
function versionBits(v: number): number {
  let rem = v
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (v << 12) | rem
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function penalty(m: boolean[][]): number {
  const n = m.length
  let p = 0
  for (let pass = 0; pass < 2; pass++) {
    const get = (i: number, j: number) => (pass ? m[j][i] : m[i][j])
    for (let i = 0; i < n; i++) {
      let run = 1
      for (let j = 1; j < n; j++) {
        if (get(i, j) === get(i, j - 1)) { run++; if (j === n - 1 && run >= 5) p += run - 2 }
        else { if (run >= 5) p += run - 2; run = 1 }
      }
      for (let j = 0; j + 10 < n; j++) {
        const s = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => get(i, j + k))
        const a = [true, false, true, true, true, false, true, false, false, false, false]
        const b = [false, false, false, false, true, false, true, true, true, false, true]
        if (s.every((v, k) => v === a[k]) || s.every((v, k) => v === b[k])) p += 40
      }
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const c = m[i][j]
    if (c === m[i][j + 1] && c === m[i + 1][j] && c === m[i + 1][j + 1]) p += 3
  }
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
  return p
}

/** Build a QR matrix (true = dark module) with a 0-module quiet zone. Throws if text is too long (>213 bytes at L, >174 at M... version 10). */
export function qrMatrix(text: string, ecc: Ecc = 'M'): boolean[][] {
  const bytes = utf8(text)
  let ver = 0
  for (let v = 1; v <= 10; v++) {
    const t = TABLE[ecc][v - 1]
    const cap = t[1] * t[2] + t[3] * t[4]
    const lenBits = v < 10 ? 8 : 16
    if (4 + lenBits + bytes.length * 8 <= cap * 8) { ver = v; break }
  }
  if (!ver) {
    if (ecc === 'M') return qrMatrix(text, 'L')
    throw new Error('qr: text too long for version 10')
  }
  const [eccLen, b1, d1, b2, d2] = TABLE[ecc][ver - 1]
  const totalData = b1 * d1 + b2 * d2

  // bit stream
  const bits: number[] = []
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  push(0b0100, 4)
  push(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, totalData * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const cw: number[] = []
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; cw.push(v) }
  for (let pad = 0xec; cw.length < totalData; pad ^= 0xec ^ 0x11) cw.push(pad)

  // blocks + interleave
  const blocks: { d: number[]; e: number[] }[] = []
  let pos = 0
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2
    const d = cw.slice(pos, pos + len); pos += len
    blocks.push({ d, e: rsEncode(d, eccLen) })
  }
  const final: number[] = []
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) final.push(b.d[i])
  for (let i = 0; i < eccLen; i++) for (const b of blocks) final.push(b.e[i])

  // matrix
  const n = 17 + ver * 4
  const m: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false))
  const fn: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false))
  const set = (x: number, y: number, v: boolean) => { m[y][x] = v; fn[y][x] = true }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= n || y >= n) continue
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(x, y, d !== 4 && d !== 2)
    }
  }
  finder(3, 3); finder(n - 4, 3); finder(3, n - 4)
  for (let i = 8; i < n - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0) }
  const al = ALIGN[ver - 1]
  for (const cy of al) for (const cx of al) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === al[al.length - 1]) || (cx === al[al.length - 1] && cy === 6)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  // reserve format areas
  for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true }
  for (let i = 0; i < 8; i++) { fn[8][n - 1 - i] = true; fn[n - 1 - i][8] = true }
  set(8, n - 8, true) // dark module
  if (ver >= 7) {
    const vb = versionBits(ver)
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >>> i) & 1) === 1
      const a = Math.floor(i / 3), b = (i % 3) + n - 11
      set(b, a, bit); set(a, b, bit)
    }
  }

  // data placement
  const dbits: boolean[] = []
  for (const c of final) for (let i = 7; i >= 0; i--) dbits.push(((c >>> i) & 1) === 1)
  let bi = 0
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? n - 1 - vert : vert
        if (!fn[y][x] && bi < dbits.length) m[y][x] = dbits[bi++]
      }
    }
  }

  const apply = (mask: number): boolean[][] => {
    const r = m.map((row) => row.slice())
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKS[mask](x, y)) r[y][x] = !r[y][x]
    const f = formatBits(ecc, mask)
    const fbit = (i: number) => ((f >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) r[i][8] = fbit(i)
    r[7][8] = fbit(6); r[8][8] = fbit(7); r[8][7] = fbit(8)
    for (let i = 9; i < 15; i++) r[8][14 - i] = fbit(i)
    for (let i = 0; i < 8; i++) r[8][n - 1 - i] = fbit(i)
    for (let i = 8; i < 15; i++) r[n - 15 + i][8] = fbit(i)
    r[n - 8][8] = true
    return r
  }
  let best: boolean[][] = [], bestP = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const r = apply(mask)
    const p = penalty(r)
    if (p < bestP) { bestP = p; best = r }
  }
  return best
}
