import sharp from 'sharp'
import type { BackgroundScene, FrameOverlay, PrintLayout } from '@shared/types'

export const SEED_LAYOUTS: PrintLayout[] = [
  { id: 'classic-4x6', name: 'Classic 4x6', size: '4x6', photosPerSheet: 1, showLogo: true, qrCode: false },
  { id: 'strip-2x6', name: 'Photo strip 2x6', size: '2x6-strip', photosPerSheet: 3, showLogo: true, qrCode: false },
  { id: 'grid-4up-5x7', name: 'Four-up 5x7', size: '5x7', photosPerSheet: 4, showLogo: true, qrCode: true },
  { id: 'wide-6x8', name: 'Wide 6x8', size: '6x8', photosPerSheet: 1, showLogo: true, qrCode: true }
]

const W = 1800, H = 1200
const anchor = { x: 0.5, y: 0.97, scale: 0.85 }

interface SeedScene { id: string; name: string; category: string; svg: string }
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`
const grad = (id: string, a: string, b: string) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
const wrap = (defs: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`

function stars(n: number): string {
  let s = '', seed = 7
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < n; i++) s += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(r() * 2.5 + 0.5).toFixed(1)}" fill="#fff" opacity="${(r() * 0.6 + 0.4).toFixed(2)}"/>`
  return s
}
function skyline(): string {
  let s = '', x = 0, seed = 11
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  while (x < W) {
    const w = 90 + r() * 110, h = 300 + r() * 520
    s += rect(x, H - h, w, h, '#1b1f3b')
    for (let wy = H - h + 25; wy < H - 30; wy += 38) for (let wx = x + 12; wx < x + w - 20; wx += 30) if (r() > 0.45) s += rect(wx, wy, 14, 20, '#ffd76a', 'opacity="0.85"')
    x += w + 6
  }
  return s
}

export const SEED_SCENES: SeedScene[] = [
  { id: 'dinosaurs', name: 'Dinosaur Valley', category: 'dinosaurs', svg: wrap(grad('s', '#f6b26b', '#fbe5c0') + grad('g', '#3f7d3a', '#1f4d22'),
    rect(0, 0, W, H, 'url(#s)') + '<circle cx="1450" cy="230" r="120" fill="#ffe08a"/>' +
    '<path d="M0 760 L350 330 L620 700 L900 420 L1250 780 L1500 520 L1800 800 L1800 1200 L0 1200Z" fill="#7a5a44"/>' +
    '<path d="M0 900 Q450 760 900 880 T1800 850 L1800 1200 L0 1200Z" fill="url(#g)"/>' +
    '<g fill="#2c5a2a"><path d="M200 900 q40 -260 120 -300 q-10 120 60 300z"/><path d="M1500 920 q-30 -300 -140 -340 q10 150 -60 340z"/></g>' +
    '<path d="M1000 880 q40 -170 130 -190 q60 -150 130 -60 q20 30 60 30 q-20 40 -70 40 q-20 90 -60 190z" fill="#4c7a3a"/>') },
  { id: 'space', name: 'Deep Space', category: 'space', svg: wrap('<radialGradient id="n" cx="70%" cy="40%" r="70%"><stop offset="0" stop-color="#5b2a86"/><stop offset="0.5" stop-color="#1b1646"/><stop offset="1" stop-color="#05030f"/></radialGradient><radialGradient id="p" cx="35%" cy="35%"><stop offset="0" stop-color="#ff9a62"/><stop offset="1" stop-color="#8a2f1c"/></radialGradient>',
    rect(0, 0, W, H, 'url(#n)') + stars(220) + '<circle cx="1350" cy="380" r="260" fill="url(#p)"/><ellipse cx="1350" cy="400" rx="400" ry="55" fill="none" stroke="#f3d9a4" stroke-width="14" opacity="0.7"/><circle cx="330" cy="260" r="70" fill="#cfd6e6"/>') },
  { id: 'ancient-egypt', name: 'Ancient Egypt', category: 'ancient egypt', svg: wrap(grad('s', '#f2c36b', '#fae9c3') + grad('d', '#e3b567', '#b98338'),
    rect(0, 0, W, H, 'url(#s)') + '<circle cx="1500" cy="260" r="130" fill="#fff3c6"/>' +
    '<path d="M250 860 L650 340 L1050 860Z" fill="#c9954a"/><path d="M650 340 L1050 860 L850 860Z" fill="#a9752f"/>' +
    '<path d="M900 860 L1280 450 L1660 860Z" fill="#d6a45a"/><path d="M1280 450 L1660 860 L1470 860Z" fill="#b5843d"/>' +
    '<path d="M0 840 Q500 780 1000 850 T1800 830 L1800 1200 L0 1200Z" fill="url(#d)"/>') },
  { id: 'ocean', name: 'Under the Sea', category: 'ocean', svg: wrap(grad('w', '#37b6d8', '#0a3d6b'),
    rect(0, 0, W, H, 'url(#w)') + '<g fill="#fff" opacity="0.15"><path d="M300 0 L600 0 L420 1200 L60 1200Z"/><path d="M1000 0 L1250 0 L1150 1200 L840 1200Z"/></g>' +
    '<g fill="#ff7a59"><path d="M1450 1200 q-60 -250 -20 -450 q40 120 60 -60 q30 150 70 0 q20 250 -10 510z"/></g><g fill="#ffd166"><path d="M250 1200 q-30 -180 30 -330 q20 80 50 -20 q40 160 -10 350z"/></g>' +
    '<g fill="#ff9f1c"><ellipse cx="900" cy="450" rx="70" ry="38"/><path d="M965 450 l60 -35 v70z"/></g><g fill="#fff" opacity="0.55"><circle cx="1100" cy="300" r="14"/><circle cx="1130" cy="230" r="9"/><circle cx="330" cy="500" r="12"/></g>') },
  { id: 'art-gallery', name: 'Art Gallery', category: 'art', svg: wrap(grad('wl', '#efe9df', '#d8cfbf'),
    rect(0, 0, W, H, 'url(#wl)') + rect(0, 930, W, 270, '#7c5a3c') + rect(0, 920, W, 14, '#4d3623') +
    [[160, 220, 340, 440, '#2a6f97'], [620, 160, 520, 360, '#c1121f'], [1260, 230, 360, 460, '#e9c46a']].map(([x, y, w, h, c]) =>
      rect(x as number - 14, y as number - 14, (w as number) + 28, (h as number) + 28, '#3a2a14') + rect(x as number, y as number, w as number, h as number, c as string) +
      `<circle cx="${(x as number) + (w as number) / 2}" cy="${(y as number) + (h as number) / 2}" r="${Math.min(w as number, h as number) / 4}" fill="#fff" opacity="0.35"/>`).join('')) },
  { id: 'city-skyline', name: 'City Skyline', category: 'city', svg: wrap(grad('s', '#ff7e5f', '#2b1b5a'),
    rect(0, 0, W, H, 'url(#s)') + '<circle cx="900" cy="640" r="170" fill="#ffd9a0" opacity="0.8"/>' + skyline()) }
]

export function seedSceneMeta(): BackgroundScene[] {
  return SEED_SCENES.map(s => ({ id: s.id, name: s.name, category: s.category, file: `backgrounds/${s.id}.jpg`, thumb: `backgrounds/${s.id}.thumb.jpg`, anchor: { ...anchor }, enabled: true }))
}

export async function renderSeedScene(id: string): Promise<{ full: Buffer; thumb: Buffer }> {
  const s = SEED_SCENES.find(x => x.id === id)
  if (!s) throw new Error(`unknown seed scene ${id}`)
  const full = await sharp(Buffer.from(s.svg)).jpeg({ quality: 88 }).toBuffer()
  const thumb = await sharp(full).resize(360, 240).jpeg({ quality: 78 }).toBuffer()
  return { full, thumb }
}

export const SEED_FRAMES: FrameOverlay[] = [{ id: 'imagine-border', name: 'imagine border', file: 'frames/imagine-border.png', enabled: true }]
export function renderSeedFrame(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="#B80021" stroke-width="28" rx="36"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
