import { useEffect, useRef } from 'react'
import { composeShot } from './assets'
import { pixelsToCanvas } from './imaging'
import type { BackgroundScene } from '../../shared/types'

/** Draws one composited shot (keyed subject on a scene). Recomposes instantly when scene/frame change. */
export default function SceneCanvas({ keyed, scene, frameFile, w = 540, h = 810, className }: {
  keyed?: ImageData; scene?: BackgroundScene; frameFile?: string; w?: number; h?: number; className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const seq = useRef(0)
  useEffect(() => {
    if (!keyed || !scene || !ref.current) return
    const mine = ++seq.current
    composeShot({ keyed, scene, frameFile, outW: w, outH: h })
      .then(img => { if (mine === seq.current && ref.current) pixelsToCanvas(img, ref.current) })
      .catch(() => { /* leave previous frame */ })
  }, [keyed, scene, frameFile, w, h])
  return <canvas ref={ref} width={w} height={h} className={className} />
}
