import sharp from 'sharp'
import type { CameraDevice, CameraDriver } from '@shared/types'

/** Generates a green-screen-looking JPEG with a person-like silhouette and timestamp. No hardware needed. */
export class SimulatedCamera implements CameraDriver {
  readonly kind = 'simulated' as const
  private connected = false
  private n = 0
  constructor(private readonly size = { width: 1800, height: 1200 }) {}

  async list(): Promise<CameraDevice[]> { return [{ id: 'simulated:0', label: 'Simulated camera (green screen)', kind: 'simulated' }] }
  async connect(_id: string): Promise<void> { this.connected = true }
  async disconnect(): Promise<void> { this.connected = false }
  async capture(): Promise<Buffer> {
    if (!this.connected) throw new Error('simulated camera not connected')
    return this.render(1)
  }
  async liveFrame(): Promise<Buffer> { return this.render(0.4) }

  private async render(scale: number): Promise<Buffer> {
    const W = Math.round(this.size.width * scale), H = Math.round(this.size.height * scale)
    const k = ++this.n
    const sway = Math.sin(k / 3) * 20
    const cx = W / 2 + sway * scale
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    // Subject colors deliberately non-green so keying works; slight lighting gradient on backdrop.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#14c05a"/><stop offset="1" stop-color="#009a3c"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g fill="#3a3a52">
    <ellipse cx="${cx}" cy="${H * 0.30}" rx="${W * 0.07}" ry="${H * 0.11}" fill="#d9a07a"/>
    <path d="M ${cx - W * 0.20} ${H} C ${cx - W * 0.20} ${H * 0.62}, ${cx - W * 0.10} ${H * 0.45}, ${cx} ${H * 0.45} C ${cx + W * 0.10} ${H * 0.45}, ${cx + W * 0.20} ${H * 0.62}, ${cx + W * 0.20} ${H} Z" fill="#b80021"/>
    <rect x="${cx - W * 0.025}" y="${H * 0.38}" width="${W * 0.05}" height="${H * 0.08}" fill="#d9a07a"/>
  </g>
  <text x="${W * 0.02}" y="${H * 0.97}" font-family="monospace, sans-serif" font-size="${Math.max(10, H * 0.03)}" fill="#ffffff">SIMULATED ${stamp} #${k}</text>
</svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
  }
}
