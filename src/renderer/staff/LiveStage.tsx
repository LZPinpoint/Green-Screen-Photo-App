// Live lineup: webcam -> GPU key -> composited over the selected scene at the exact print geometry, plus countdown/flash/guides.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { createKeyPreview } from '@core/index'
import type { BackgroundScene, FrameOverlay, KeyParams } from '../../shared/types'
import { assetUrl } from '../kiosk/assets'
import { loadImage } from '../kiosk/imaging'
import { Spinner } from '../kiosk/Chrome'
import type { Frame } from './pipeline'
import type { Engine } from './engineClient'
import { DISPLAY_FPS, type createDisplayPublisher } from './displayBus'
import { useBackdropWatch } from '../keying/aiBridge'
import { healthFromQuality, subjectRect, type Health } from './staffLogic'

export const STAGE_W = 640
export const STAGE_H = 960

export interface StageHandle { grab(): Promise<Frame>; videoSize(): { w: number; h: number } }

interface Props {
  stream: MediaStream | null
  useVideo: boolean              // webcam: grab the video frame; otherwise ask the tethered camera
  keyParams: KeyParams
  scene?: BackgroundScene
  frame?: FrameOverlay
  guides: boolean
  count: number                  // countdown number on screen (0 = none)
  flashId: number                // increments to fire the flash
  note?: string                  // e.g. 'hold still 2/3'
  getEngine: () => Promise<Engine>
  publisher: ReturnType<typeof createDisplayPublisher>
  onHealth(h: Health): void
}

const LiveStage = forwardRef<StageHandle, Props>(function LiveStage(p, ref) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const outRef = useRef<HTMLCanvasElement>(null)
  const gl = useMemo(() => {
    const c = document.createElement('canvas')
    // pre-create the context so reads outside the keyer's own frame loop stay valid (getContext returns this one later)
    try { c.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: true, alpha: true, antialias: false }) } catch { /* keyer falls back below */ }
    return c
  }, [])
  const st = useRef({ bg: null as HTMLCanvasElement | null, frameImg: null as HTMLImageElement | null, scene: p.scene, key: p.keyParams, health: p.onHealth, keyer: false, hint: '', raw: false })
  // no green backdrop / screen doesn't fill the picture: checked ~2x per second on a tiny frame (not per video frame)
  const live = useBackdropWatch(videoRef, !!p.stream, p.keyParams)
  st.current.scene = p.scene; st.current.key = live.stage ? { ...p.keyParams, stage: live.stage } : p.keyParams; st.current.health = p.onHealth
  st.current.hint = live.hint; st.current.raw = live.noGreen
  useEffect(() => { if (live.hint) p.onHealth({ level: 'warn', text: live.hint }) }, [live.hint])  // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    videoSize: () => ({ w: videoRef.current?.videoWidth ?? 0, h: videoRef.current?.videoHeight ?? 0 }),
    async grab() {
      const v = videoRef.current
      if (p.useVideo && v && v.videoWidth) return { bitmap: await createImageBitmap(v) }
      return { url: await window.booth.camera.capture() }
    }
  }), [p.useVideo])

  // attach the stream + start the GPU keyer (video is drawn raw if WebGL is unavailable)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !p.stream) return
    v.srcObject = p.stream
    v.play().catch(() => {})
    let preview: ReturnType<typeof createKeyPreview> | null = null
    try { preview = createKeyPreview(gl, v, () => st.current.key); preview.start(); st.current.keyer = true } catch { st.current.keyer = false }
    return () => { try { preview?.stop() } catch { /* noop */ } }
  }, [p.stream, gl])

  // scene backdrop (cover-fit once, not per frame)
  useEffect(() => {
    let dead = false
    st.current.bg = null
    if (!p.scene) return
    assetUrl(p.scene.file).then(loadImage).then(img => {
      if (dead) return
      const c = document.createElement('canvas'); c.width = STAGE_W; c.height = STAGE_H
      const k = Math.max(STAGE_W / img.naturalWidth, STAGE_H / img.naturalHeight)
      const w = img.naturalWidth * k, h = img.naturalHeight * k
      c.getContext('2d')!.drawImage(img, (STAGE_W - w) / 2, (STAGE_H - h) / 2, w, h)
      st.current.bg = c
    }).catch(() => { /* backdrop stays plain */ })
    return () => { dead = true }
  }, [p.scene])
  useEffect(() => {
    let dead = false
    st.current.frameImg = null
    if (!p.frame) return
    assetUrl(p.frame.file).then(loadImage).then(img => { if (!dead) st.current.frameImg = img }).catch(() => {})
    return () => { dead = true }
  }, [p.frame])

  // draw loop + display feed
  useEffect(() => {
    const out = outRef.current; if (!out) return
    const ctx = out.getContext('2d')!
    let raf = 0, dead = false, lastPub = 0, pubBusy = false
    const loop = (t: number) => {
      if (dead) return
      raf = requestAnimationFrame(loop)
      const s = st.current
      const v = videoRef.current
      ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, STAGE_W, STAGE_H)
      if (s.bg) ctx.drawImage(s.bg, 0, 0)
      if (v && v.videoWidth && v.readyState >= 2) {
        const sc = s.scene
        const r = subjectRect(sc?.anchor ?? { x: 0.5, y: 1, scale: 0.78 }, v.videoWidth, v.videoHeight, STAGE_W, STAGE_H)
        if (s.raw) {
          // no green screen: show the camera as it is (cover-fit, mirrored like the keyed view); an un-keyed rectangle pasted on the scene would look like a failure
          const k = Math.max(STAGE_W / v.videoWidth, STAGE_H / v.videoHeight), vw = v.videoWidth * k, vh = v.videoHeight * k
          ctx.drawImage(v, (STAGE_W - vw) / 2, (STAGE_H - vh) / 2, vw, vh)
        } else if (s.keyer && gl.width > 1) ctx.drawImage(gl, r.left, r.top, r.w, r.h)
        else if (!s.keyer) ctx.drawImage(v, r.left, r.top, r.w, r.h)
      }
      if (s.frameImg) ctx.drawImage(s.frameImg, 0, 0, STAGE_W, STAGE_H)
      if (!pubBusy && p.publisher.listening && t - lastPub >= 1000 / DISPLAY_FPS) {
        lastPub = t; pubBusy = true
        createImageBitmap(out).then(b => { p.publisher.send({ type: 'frame', bitmap: b }); b.close() }).catch(() => {}).finally(() => { pubBusy = false })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => { dead = true; cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, p.publisher])

  // green-screen health, every 2s on a small frame (analysed in the worker)
  useEffect(() => {
    if (!p.stream) return
    let dead = false, busy = false
    const t = window.setInterval(async () => {
      const v = videoRef.current
      if (dead || busy || !v || !v.videoWidth || v.readyState < 2) return
      busy = true
      try {
        const bmp = await createImageBitmap(v, { resizeWidth: 320, resizeQuality: 'low' })
        const eng = await p.getEngine()
        const q = await eng.call<{ coverage: number; edgeNoise: number; greenFrac: number }>('health', { bitmap: bmp, key: st.current.key }, [bmp])
        if (!dead && !st.current.hint && !st.current.raw) st.current.health(healthFromQuality(q))
      } catch { /* keep the previous reading */ } finally { busy = false }
    }, 2000)
    return () => { dead = true; window.clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.stream])

  return (
    <div className="st-stage" data-testid="stage">
      <div className="st-frame" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
        <video ref={videoRef} muted playsInline className="st-video" />
        <canvas ref={outRef} width={STAGE_W} height={STAGE_H} className="st-out" aria-label="live preview: the group in the selected scene" />
        {p.guides && (
          <div className="st-guides" aria-hidden="true">
            <i className="g-safe" /><i className="g-centre" /><i className="g-head"><b>heads here</b></i>
          </div>
        )}
        {!p.stream && <Spinner label="warming up the camera" />}
        {p.count > 0 && <div className="st-count" key={p.count} aria-hidden="true">{p.count}</div>}
        {p.note && <div className="st-note">{p.note}</div>}
        {p.flashId > 0 && <div className="st-flash" key={p.flashId} />}
      </div>
    </div>
  )
})
export default LiveStage
