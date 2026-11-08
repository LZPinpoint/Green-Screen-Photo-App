// Scene/frame image cache + compositing helpers shared by the kiosk screens.
import { composeScene } from '@core/index'
import type { BackgroundScene } from '../../shared/types'
import { dataUrlToImageData, toImageData, type Pixels } from './imaging'

const urlCache = new Map<string, Promise<string>>()
const dataCache = new Map<string, Promise<ImageData>>()

/** data URL for a library image (cached) */
export function assetUrl(file: string): Promise<string> {
  let p = urlCache.get(file)
  if (!p) { p = window.booth.library.imageUrl(file); urlCache.set(file, p); p.catch(() => urlCache.delete(file)) }
  return p
}

/** decoded pixels for a library image (cached, downscaled so the longest side <= maxDim) */
export function assetPixels(file: string, maxDim = 1800): Promise<ImageData> {
  const k = file + '@' + maxDim
  let p = dataCache.get(k)
  if (!p) { p = assetUrl(file).then(u => dataUrlToImageData(u, maxDim)); dataCache.set(k, p); p.catch(() => dataCache.delete(k)) }
  return p
}

export function clearAssetCache() { urlCache.clear(); dataCache.clear() }

export interface ComposeInput { keyed: Pixels; scene: BackgroundScene; frameFile?: string; outW: number; outH: number }

export async function composeShot({ keyed, scene, frameFile, outW, outH }: ComposeInput): Promise<ImageData> {
  const [bg, frame] = await Promise.all([assetPixels(scene.file), frameFile ? assetPixels(frameFile) : Promise.resolve(undefined)])
  const out = composeScene({ subject: keyed, scene: bg, anchor: scene.anchor, frame, outW, outH } as never) as unknown as Pixels
  return toImageData(out)
}
