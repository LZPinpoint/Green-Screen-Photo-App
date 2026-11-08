import { useCallback, useEffect, useRef, useState } from 'react'
import { createKeyPreview } from '@core/index'
import { assetPixels } from './assets'
import { newCanvas, grabFrame, toImageData } from './imaging'
import { Spinner } from './Chrome'
import type { Cfg } from './types'

interface Props {
  cfg: Cfg
  stream: MediaStream | null
  shotIndex: number
  onCapture: (raw: string) => void
  onBack: () => void
  ping: () => void
}

type Phase = 'ready' | 'counting' | 'shooting'

export default function PoseScreen({ cfg, stream, shotIndex, onCapture, onBack, ping }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const [camErr, setCamErr] = useState('')
  const keyRef = useRef(cfg.settings.key); keyRef.current = cfg.settings.key
  const useVideo = (cfg.camera?.kind ?? 'webcam') === 'webcam'

  // live keyed preview over the webcam stream (plain video draw if the keyer is unavailable)
  useEffect(() => {
    const v = videoRef.current, c = canvasRef.current
    if (!v || !c || !stream) return
    v.srcObject = stream
    let preview: ReturnType<typeof createKeyPreview> | null = null
    let raf = 0, dead = false
    const startPreview = async () => {
      try {
        await v.play().catch(() => {})
        preview = createKeyPreview(c, v, () => keyRef.current)
        const bg = cfg.scenes[0]
        if (bg) {
          const px = await assetPixels(bg.file, 1200)
          const bc = newCanvas(px.width, px.height); bc.getContext('2d')!.putImageData(toImageData(px), 0, 0)
          if (!dead) preview.setBackground(bc)
        }
        preview.start()
      } catch {
        const ctx = c.getContext('2d')!
        const draw = () => { if (dead) return; c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720; ctx.drawImage(v, 0, 0, c.width, c.height); raf = requestAnimationFrame(draw) }
        draw()
      }
    }
    startPreview()
    return () => { dead = true; cancelAnimationFrame(raf); try { preview?.stop() } catch { /* noop */ } }
  }, [stream, cfg.scenes])

  const shoot = useCallback(async () => {
    setPhase('shooting'); setFlash(true)
    setTimeout(() => setFlash(false), 450)
    try {
      const raw = useVideo && videoRef.current && videoRef.current.videoWidth
        ? grabFrame(videoRef.current)
        : await window.booth.camera.capture()
      onCapture(raw)
    } catch {
      setCamErr('the camera needs a hand. please ask a team member.')
      setPhase('ready')
    }
  }, [onCapture, useVideo])

  useEffect(() => {
    if (phase !== 'counting') return
    ping()
    if (count <= 0) { shoot(); return }
    const t = setTimeout(() => setCount(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, count, shoot, ping])

  const start = () => { setCamErr(''); setCount(Math.max(1, cfg.settings.countdownSec)); setPhase('counting') }
  const total = cfg.layout.photosPerSheet

  return (
    <main className="k-screen k-pose">
      <div className="pose-frame im-card">
        <video ref={videoRef} muted playsInline className="pose-video" />
        <canvas ref={canvasRef} className="pose-canvas" />
        {!stream && <Spinner label="warming up the camera" />}
        <div className="pose-guide" aria-hidden="true" />
        {phase === 'counting' && count > 0 && <div className="pose-count" key={count}>{count}</div>}
        {flash && <div className="pose-flash" />}
        {total > 1 && <div className="pose-badge">photo {shotIndex + 1} of {total}</div>}
      </div>
      <div className="pose-bar">
        <p className="pose-hint">
          {camErr || (phase === 'counting' ? 'hold that pose!' : phase === 'shooting' ? 'got it!' : 'step onto the green and strike your best pose')}
        </p>
        <div className="row">
          <button className="im-btn ghost" onClick={onBack} disabled={phase !== 'ready'}>back</button>
          <button className="im-btn big" onClick={start} disabled={phase !== 'ready' || !stream}>
            {phase === 'ready' ? "i'm ready" : '...'}
          </button>
        </div>
      </div>
    </main>
  )
}
