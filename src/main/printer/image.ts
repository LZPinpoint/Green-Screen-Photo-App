import sharp from 'sharp'
import type { PrintSize } from '@shared/types'
import { printPixels } from './sizes'

/** Render an image to exact paper pixels @300dpi (portrait). Landscape sources are rotated 90deg; aspect mismatch is cover-cropped. */
export async function prepareForPrint(input: string | Buffer, size: PrintSize): Promise<{ png: Buffer; jpeg: Buffer; width: number; height: number }> {
  const { w, h } = printPixels(size)
  const meta = await sharp(input).metadata()
  let img = sharp(input).rotate() // honour EXIF
  if ((meta.width ?? 0) > (meta.height ?? 0)) img = sharp(await img.toBuffer()).rotate(90)
  const flat = img.resize(w, h, { fit: 'cover' }).flatten({ background: '#ffffff' })
  const png = await flat.clone().png().toBuffer()
  const jpeg = await flat.clone().jpeg({ quality: 95 }).toBuffer()
  return { png, jpeg, width: w, height: h }
}

/** Minimal single-page PDF embedding a JPEG at exact physical size (points = inches*72). */
export function jpegToPdf(jpeg: Buffer, pxW: number, pxH: number, inW: number, inH: number): Buffer {
  const pw = +(inW * 72).toFixed(2), ph = +(inH * 72).toFixed(2)
  const parts: Buffer[] = []
  const offsets: number[] = []
  let pos = 0
  const push = (b: Buffer) => { parts.push(b); pos += b.length }
  push(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'))
  const obj = (n: number, body: Buffer | string) => { offsets[n] = pos; push(Buffer.from(`${n} 0 obj\n`)); push(Buffer.isBuffer(body) ? body : Buffer.from(body)); push(Buffer.from('\nendobj\n')) }
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  obj(4, Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]))
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  const xref = pos
  let x = 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(Buffer.from(`${x}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return Buffer.concat(parts)
}
