import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { keyFrame } from '../keying/autoKey'
import { kioskEngines } from '../keying/aiBridge'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { flowReducer, initialFlow } from './flow'
import { Header } from './Chrome'
import IdleScreen from './IdleScreen'
import WelcomeScreen from './WelcomeScreen'
import PoseScreen from './PoseScreen'
import ReviewScreen from './ReviewScreen'
import ScenesScreen from './ScenesScreen'
import PreviewScreen from './PreviewScreen'
import ShareScreen, { type Reservation } from './ShareScreen'
import { PrintingScreen, ThanksScreen } from './PrintScreens'
import { useCamera } from './useCamera'
import { dataUrlToImageData, toImageData, type Pixels } from './imaging'
import type { Cfg, Shot } from './types'
import './kiosk.css'

const THANKS_SECONDS = 8
const WARN_SECONDS = 10

async function loadCfg(): Promise<Cfg> {
  const b = window.booth
  const [settings, scenes, frames, layouts, cams] = await Promise.all([
    b.settings.get().catch(() => DEFAULT_SETTINGS), b.library.scenes().catch(() => []), b.library.frames().catch(() => []),
    b.library.layouts().catch(() => []), b.camera.list().catch(() => [])
  ])
  const layout = layouts.find(l => l.id === settings.defaultLayoutId) ?? layouts[0]
    ?? { id: 'fallback', name: 'classic', size: '4x6' as const, photosPerSheet: 1 as const, showLogo: true, qrCode: false }
  return {
    settings, layout,
    scenes: scenes.filter(s => s.enabled),
    frames: frames.filter(f => f.enabled),
    camera: cams.find(c => c.id === settings.cameraId) ?? cams[0]
  }
}

async function loadShareEnabled(): Promise<boolean> {
  try { return !!(await window.booth.share?.enabled()) } catch { return false }
}

export default function KioskApp() {
  const [flow, dispatch] = useReducer(flowReducer, undefined, () => initialFlow())
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [warn, setWarn] = useState<number | null>(null)
  const sessionId = useRef<Promise<string> | null>(null)
  const sheet = useRef<string>('')
  const reservation = useRef<Promise<Reservation | null> | null>(null)
  const epoch = useRef(flow.epoch); epoch.current = flow.epoch
  const last = useRef(Date.now())
  const ping = useCallback(() => { last.current = Date.now() }, [])

  // config (re)loads on boot and each time we return to idle, so admin changes show up for the next guest
  useEffect(() => {
    if (flow.screen !== 'idle' && cfg) return
    let dead = false
    Promise.all([loadCfg(), loadShareEnabled()]).then(([c, shareEnabled]) => {
      if (dead) return
      setCfg(c)
      dispatch({ type: 'configure', shotsNeeded: c.layout.photosPerSheet, maxCopies: c.settings.maxPrintsPerSession, shareEnabled })
    })
    return () => { dead = true }
  }, [flow.screen === 'idle', flow.epoch]) // eslint-disable-line react-hooks/exhaustive-deps

  // a new epoch = a dead session: wipe every in-memory image
  useEffect(() => { setShots([]); sessionId.current = null; sheet.current = ''; reservation.current = null; setWarn(null); ping() }, [flow.epoch, ping])

  // guest scenes default
  useEffect(() => {
    if (flow.screen === 'scenes' && !flow.sceneId && cfg?.scenes[0]) dispatch({ type: 'pickScene', id: cfg.scenes[0].id })
  }, [flow.screen, flow.sceneId, cfg])

  // global idle timeout
  useEffect(() => {
    const touch = () => { last.current = Date.now() }
    window.addEventListener('pointerdown', touch, true); window.addEventListener('keydown', touch, true)
    const t = setInterval(() => {
      if (flow.screen === 'idle') { setWarn(null); return }
      const limit = (cfg?.settings.idleTimeoutSec ?? 60) * 1000
      const left = limit - (Date.now() - last.current)
      if (left <= 0) dispatch({ type: 'timeout' })
      else setWarn(left <= WARN_SECONDS * 1000 && flow.screen !== 'printing' && flow.screen !== 'thanks' && flow.screen !== 'share' ? Math.ceil(left / 1000) : null)
    }, 500)
    return () => { clearInterval(t); window.removeEventListener('pointerdown', touch, true); window.removeEventListener('keydown', touch, true) }
  }, [flow.screen, cfg?.settings.idleTimeoutSec])

  // thanks -> idle
  useEffect(() => {
    if (flow.screen !== 'thanks') return
    const t = setTimeout(() => dispatch({ type: 'reset' }), THANKS_SECONDS * 1000)
    return () => clearTimeout(t)
  }, [flow.screen])

  const camera = useCamera(['welcome', 'pose', 'review'].includes(flow.screen), cfg?.camera?.kind === 'webcam' ? cfg.camera.id : undefined)

  const keyShot = useCallback(async (index: number, raw: string, ep: number) => {
    try {
      const px = await dataUrlToImageData(raw, 1600)
      // never throws: ai problems fall back to the green key and say why in `reason`
      const r = await keyFrame(px, cfg!.settings.key, kioskEngines())
      const keyed = toImageData(r.image as unknown as Pixels)
      if (ep === epoch.current) setShots(s => s.map((x, i) => i === index ? { ...x, keyed, engine: r.engineUsed, note: r.reason } : x))
    } catch {
      if (ep === epoch.current) setShots(s => s.map((x, i) => i === index ? { ...x, failed: true } : x))
    }
  }, [cfg])

  const onConsent = () => {
    sessionId.current = window.booth.session.start().then(s => s.id)
    sessionId.current.catch(() => {})
    dispatch({ type: 'consent' })
  }

  const onCapture = useCallback((raw: string) => {
    const ep = epoch.current, index = shots.length
    setShots(s => [...s, { raw }])
    dispatch({ type: 'captured' })
    keyShot(index, raw, ep)
    sessionId.current?.then(id => window.booth.session.saveShot(id, raw)).catch(() => {})
  }, [shots.length, keyShot])

  const onRetake = () => { setShots(s => s.slice(0, -1)); dispatch({ type: 'retake' }) }

  // one guest link per session, reserved before the print sheet is built (so its QR can be printed). null => no share, never throws.
  const reserve = useCallback((): Promise<Reservation | null> => {
    if (!reservation.current) {
      const idp = sessionId.current ?? (sessionId.current = window.booth.session.start().then(s => s.id))
      reservation.current = idp.then(id => window.booth.share.reserve(id)).then(r => r ?? null).catch(() => null)
    }
    return reservation.current
  }, [])

  const doPrint = useCallback(async () => {
    dispatch({ type: 'print' })
    const ep = epoch.current
    try {
      const id = await (sessionId.current ?? (sessionId.current = window.booth.session.start().then(s => s.id)))
      if (flow.shareEnabled) await reserve() // the upload starts when the composite is saved: the link must exist first
      await window.booth.session.saveComposite(id, sheet.current)
      await window.booth.printer.print(id, flow.copies)
      if (ep === epoch.current) dispatch({ type: 'printOk' })
    } catch (e) {
      if (ep === epoch.current) dispatch({ type: 'printFail', error: e instanceof Error ? e.message : 'print failed' })
    }
  }, [flow.copies, flow.shareEnabled, reserve])

  const accent = cfg?.settings.brand.accent
  const style = accent ? ({ '--im-red': accent } as React.CSSProperties) : undefined
  const s = flow.screen
  const showHeader = s !== 'idle'

  return (
    <div className="kiosk" style={style} data-screen={s}>
      {showHeader && <Header screen={s} onStartOver={() => dispatch({ type: 'reset' })} />}
      {s === 'idle' && <IdleScreen cfg={cfg} onTouch={() => dispatch({ type: 'touch' })} />}
      {s === 'welcome' && <WelcomeScreen cfg={cfg} shareEnabled={flow.shareEnabled} onConsent={onConsent} onBack={() => dispatch({ type: 'back' })} />}
      {s === 'pose' && cfg && (
        <PoseScreen key={flow.shots} cfg={cfg} stream={camera.stream} shotIndex={flow.shots} onCapture={onCapture}
          onBack={() => dispatch({ type: 'back' })} ping={ping} />
      )}
      {s === 'review' && cfg && (
        <ReviewScreen cfg={cfg} shot={shots[flow.reviewIndex]} index={flow.reviewIndex} onRetake={onRetake}
          onContinue={() => dispatch({ type: 'continue' })} />
      )}
      {s === 'scenes' && cfg && (
        <ScenesScreen cfg={cfg} shots={shots} sceneId={flow.sceneId} frameId={flow.frameId}
          onPickScene={id => dispatch({ type: 'pickScene', id })} onPickFrame={id => dispatch({ type: 'pickFrame', id })}
          onNext={() => dispatch({ type: 'toPreview' })} onBack={() => dispatch({ type: 'back' })} />
      )}
      {s === 'preview' && cfg && (
        <PreviewScreen cfg={cfg} shots={shots} sceneId={flow.sceneId} frameId={flow.frameId} copies={flow.copies} maxCopies={flow.maxCopies}
          shareEnabled={flow.shareEnabled} reserve={reserve}
          onCopies={n => dispatch({ type: 'setCopies', copies: n })} onSheet={u => { sheet.current = u }}
          onPrint={doPrint} onBack={() => dispatch({ type: 'back' })} />
      )}
      {s === 'printing' && <PrintingScreen error={flow.printError} copies={flow.copies} onRetry={doPrint} onBack={() => dispatch({ type: 'back' })} />}
      {s === 'share' && cfg && <ShareScreen cfg={cfg} reservation={reserve()} onDone={() => dispatch({ type: 'done' })} />}
      {s === 'thanks' && <ThanksScreen venue={cfg?.settings.venueName} seconds={THANKS_SECONDS} onDone={() => dispatch({ type: 'reset' })} />}
      {warn !== null && (
        <div className="k-warn" onPointerDown={ping}>
          <div><h3>still there?</h3><p>tap anywhere to keep going ({warn})</p></div>
        </div>
      )}
    </div>
  )
}
