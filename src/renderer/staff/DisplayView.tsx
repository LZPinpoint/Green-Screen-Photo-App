// Guest-facing display (#/display): fullscreen mirror of the operator's keyed preview, countdown, flash and "next please".
import { useEffect, useRef, useState } from 'react'
import { createDisplayReceiver, type DisplayMsg } from './displayBus'
import Wordmark from '../kiosk/Wordmark'
import './staff.css'

export default function DisplayView() {
  const main = useRef<HTMLCanvasElement>(null)
  const back = useRef<HTMLCanvasElement>(null)
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState(0)
  const [scene, setScene] = useState('')
  const [next, setNext] = useState('')
  const [live, setLive] = useState(false)
  const lastFrame = useRef(0)

  useEffect(() => {
    document.title = 'imagine · guest display'
    const draw = (bmp: ImageBitmap) => {
      for (const c of [main.current, back.current]) {
        if (!c) continue
        if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height }
        c.getContext('2d')!.drawImage(bmp, 0, 0)
      }
      bmp.close()
    }
    const rx = createDisplayReceiver((m: DisplayMsg) => {
      switch (m.type) {
        case 'frame': lastFrame.current = Date.now(); setLive(true); draw(m.bitmap); break
        case 'countdown': setCount(m.n); break
        case 'flash': setFlash(f => f + 1); break
        case 'scene': setScene(m.name); break
        case 'next': setNext(m.text); break
      }
    })
    const t = window.setInterval(() => { if (Date.now() - lastFrame.current > 3000) setLive(false) }, 1000)
    return () => { rx.close(); window.clearInterval(t) }
  }, [])

  const goFull = () => { document.documentElement.requestFullscreen?.().catch(() => {}) }

  return (
    <div className="gd" onDoubleClick={goFull}>
      <canvas ref={back} className="gd-back" aria-hidden="true" />
      <canvas ref={main} className="gd-main" aria-label="live preview of you in the scene" />
      {!live && (
        <div className="gd-wait" role="status">
          <Wordmark size={84} />
          <p>step onto the green</p>
          <small>waiting for the operator · double-click for fullscreen</small>
        </div>
      )}
      {live && scene && <div className="gd-scene">{scene}</div>}
      {count > 0 && <div className="gd-count" key={count} aria-live="assertive">{count}</div>}
      {next && <div className="gd-next" role="status">{next}</div>}
      {flash > 0 && <div className="gd-flash" key={flash} />}
    </div>
  )
}
