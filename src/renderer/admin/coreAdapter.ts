// Single seam between admin UI and @core/index. Option shapes for composeScene/layoutSheet are not in the stub's
// types, so they're isolated here: adjust ONLY this file if agent A's final signatures differ.
import * as core from '@core/index'
import type { RGBAImage } from '@core/index'
import { logoRGBA } from './imgutil'
import type { KeyParams, PrintLayout, BackgroundScene } from '../../shared/types'

export type { RGBAImage }
export const chromaKey = (img: RGBAImage, p: KeyParams): RGBAImage => core.chromaKey(img, p)
export const autoCalibrate = (img: RGBAImage): [number, number, number] => core.autoCalibrate(img)
export const coreKeyQuality = (img: RGBAImage, p: KeyParams) => core.keyQuality(img, p)
export const qrMatrix = (t: string): boolean[][] => core.qrMatrix(t)

export function compose(subject: RGBAImage, scene: RGBAImage, anchor: BackgroundScene['anchor'], width: number, height: number, frame?: RGBAImage): RGBAImage {
  return core.composeScene({ subject, scene, anchor, frame, outW: width, outH: height })
}
export function sheet(layout: PrintLayout, shots: RGBAImage[], extra: core.LayoutOpts = {}): RGBAImage {
  return core.layoutSheet(layout, shots, {
    footerText: layout.footerText,
    logo: layout.showLogo ? logoRGBA() : undefined,
    qr: layout.qrCode ? core.qrMatrix('https://imagine.example/p/preview') : undefined,
    ...extra
  })
}

/** Mark a session as a staff hardware test so stats exclude it. The preload exposes session.update; BoothAPI's type does not. */
export async function markTestSession(id: string): Promise<void> {
  try { await (window.booth.session as unknown as { update?: (id: string, p: { test: boolean }) => Promise<unknown> }).update?.(id, { test: true }) } catch { /* best effort */ }
}
