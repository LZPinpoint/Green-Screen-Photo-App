import type { PrintSize } from '@shared/types'

export const PRINT_DPI = 300
/** Physical paper size (portrait: width x height, inches). */
export const PRINT_INCHES: Record<PrintSize, { w: number; h: number }> = {
  '4x6': { w: 4, h: 6 },
  '2x6-strip': { w: 2, h: 6 },
  '5x7': { w: 5, h: 7 },
  '6x8': { w: 6, h: 8 }
}
export const printPixels = (s: PrintSize) => ({ w: PRINT_INCHES[s].w * PRINT_DPI, h: PRINT_INCHES[s].h * PRINT_DPI })
/** Microns for Electron's webContents.print pageSize. */
export const printMicrons = (s: PrintSize) => ({ width: Math.round(PRINT_INCHES[s].w * 25400), height: Math.round(PRINT_INCHES[s].h * 25400) })

/** Map PrintSize -> media name (PWG self-describing + driver-friendly label). Used for logs / CUPS-style hints. */
export const MEDIA_NAME: Record<PrintSize, string> = {
  '4x6': 'na_index-4x6_4x6in',
  '2x6-strip': 'custom_2x6in_2x6in',
  '5x7': 'na_5x7_5x7in',
  '6x8': 'custom_6x8in_6x8in'
}
