import type { CameraDevice, CameraDriver } from '@shared/types'
import { log } from '../logger'
import { CameraError } from './exec'

export const WEBCAM_MARKER: CameraDevice = { id: 'webcam:default', label: 'Webcam (browser)', kind: 'webcam' }

/** Routes camera calls to a driver. Device ids carry a driver prefix: simulated:, gphoto2:, digicam:, webcam:. */
export class CameraManager {
  private current?: { device: CameraDevice; driver: CameraDriver }
  private cache: { device: CameraDevice; driver: CameraDriver }[] = []
  constructor(private readonly drivers: { simulated: CameraDriver; dslr: CameraDriver[] }, private readonly opts: { reconnectAttempts?: number } = {}) {}

  async list(): Promise<CameraDevice[]> {
    const entries: { device: CameraDevice; driver: CameraDriver }[] = []
    const all: [CameraDriver, string][] = [[this.drivers.simulated, 'simulated'], ...this.drivers.dslr.map((d): [CameraDriver, string] => [d, 'dslr'])]
    const results = await Promise.all(all.map(async ([d]) => { try { return await d.list() } catch (e) { log.warn('camera list failed', e); return [] as CameraDevice[] } }))
    results.forEach((devs, i) => devs.forEach(device => entries.push({ device, driver: all[i][0] })))
    this.cache = entries
    return [WEBCAM_MARKER, ...entries.map(e => e.device)]
  }

  async connect(id: string): Promise<void> {
    if (id.startsWith('webcam:') || id === WEBCAM_MARKER.id) { await this.current?.driver.disconnect().catch(() => undefined); this.current = undefined; return }
    if (!this.cache.some(e => e.device.id === id)) await this.list()
    const entry = this.cache.find(e => e.device.id === id)
    if (!entry) throw new CameraError('no-device', `Unknown camera ${id}`)
    if (this.current && this.current.driver !== entry.driver) await this.current.driver.disconnect().catch(() => undefined)
    await entry.driver.connect(id)
    this.current = entry
  }

  get currentId(): string | undefined { return this.current?.device.id }

  async capture(): Promise<Buffer> {
    const cur = this.current
    if (!cur) throw new CameraError('not-connected', 'No tethered camera connected (webcams capture in the renderer).')
    try {
      return await cur.driver.capture()
    } catch (e) {
      log.warn('capture failed, attempting reconnect', e)
      const attempts = this.opts.reconnectAttempts ?? 1
      let last: unknown = e
      for (let i = 0; i < attempts; i++) {
        try {
          await cur.driver.disconnect().catch(() => undefined)
          await cur.driver.connect(cur.device.id)
          return await cur.driver.capture()
        } catch (e2) { last = e2 }
      }
      throw last
    }
  }
}
