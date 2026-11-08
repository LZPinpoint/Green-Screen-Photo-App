import type { BackgroundScene, FrameOverlay, PrintLayout, VenueSettings, ImageData64, CameraDevice } from '../../shared/types'

export interface Cfg {
  settings: VenueSettings
  scenes: BackgroundScene[]
  frames: FrameOverlay[]
  layout: PrintLayout
  camera?: CameraDevice
}

export type { Reservation } from './ShareScreen'

/** In-memory only. Wiped whenever the flow epoch changes. */
export interface Shot { raw: ImageData64; keyed?: ImageData; failed?: boolean }
