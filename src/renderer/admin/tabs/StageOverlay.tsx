import { useEffect, useRef, useState } from 'react'
import type { Stage } from '../../keying/autoKey'

type Side = keyof Stage
/** Draggable stage margins drawn over the raw preview (positioned on the letterboxed frame, so it works for any aspect). */
export default function StageOverlay({ stage, frame, onChange }: { stage: Stage; frame: { w: number; h: number } | null; onChange: (s: Stage) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const drag = useRef<Side | null>(null)
  useEffect(() => {
    const el = box.current?.parentElement; if (!el || !frame) return
    const calc = () => {
      const r = el.getBoundingClientRect(); const s = Math.min(r.width / frame.w, r.height / frame.h)
      const w = frame.w * s, h = frame.h * s
      setRect({ x: (r.width - w) / 2, y: (r.height - h) / 2, w, h })
    }
    calc(); const ro = new ResizeObserver(calc); ro.observe(el); return () => ro.disconnect()
  }, [frame])
  if (!frame) return null
  const clamp = (v: number) => Math.min(0.45, Math.max(0, v))
  const move = (e: React.PointerEvent) => {
    const side = drag.current; if (!side) return
    const r = box.current!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / rect.w, fy = (e.clientY - r.top) / rect.h
    onChange({ ...stage, [side]: clamp(side === 'left' ? fx : side === 'right' ? 1 - fx : side === 'top' ? fy : 1 - fy) })
  }
  const bar = (side: Side): React.CSSProperties => {
    const horiz = side === 'top' || side === 'bottom'
    const p = stage[side] * 100
    return { position: 'absolute', background: '#ffd23f', pointerEvents: 'auto', cursor: horiz ? 'ns-resize' : 'ew-resize', touchAction: 'none',
      ...(horiz ? { left: 0, right: 0, height: 4, [side]: `calc(${p}% - 2px)` } : { top: 0, bottom: 0, width: 4, [side]: `calc(${p}% - 2px)` }) }
  }
  const shade: React.CSSProperties = { position: 'absolute', background: 'rgba(0,0,0,.55)', pointerEvents: 'none' }
  return (
    <div ref={box} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, pointerEvents: 'none' }} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null }}>
      <i style={{ ...shade, left: 0, top: 0, bottom: 0, width: `${stage.left * 100}%` }} />
      <i style={{ ...shade, right: 0, top: 0, bottom: 0, width: `${stage.right * 100}%` }} />
      <i style={{ ...shade, top: 0, left: `${stage.left * 100}%`, right: `${stage.right * 100}%`, height: `${stage.top * 100}%` }} />
      <i style={{ ...shade, bottom: 0, left: `${stage.left * 100}%`, right: `${stage.right * 100}%`, height: `${stage.bottom * 100}%` }} />
      <div style={{ position: 'absolute', left: `${stage.left * 100}%`, right: `${stage.right * 100}%`, top: `${stage.top * 100}%`, bottom: `${stage.bottom * 100}%`, border: '1px dashed #ffd23f', pointerEvents: 'none' }} />
      {(['left', 'right', 'top', 'bottom'] as Side[]).map(side => (
        <div key={side} role="slider" aria-label={`stage ${side} margin`} aria-valuemin={0} aria-valuemax={45} aria-valuenow={Math.round(stage[side] * 100)}
          style={bar(side)} onPointerDown={e => { e.stopPropagation(); drag.current = side; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) }} />
      ))}
    </div>
  )
}
