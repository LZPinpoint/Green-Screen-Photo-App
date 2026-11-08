import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Chip, Field, Seg, Slider, useLoad, useToast, libImage } from '../ui'
import { analyzeFrame, resetKey, rgbToHex, tipsFromStats } from '../helpers'
import type { QualityReport } from '../helpers'
import { autoCalibrate, chromaKey, coreKeyQuality } from '../coreAdapter'
import type { RGBAImage } from '../coreAdapter'
import { fileToDataUrl, loadImg, makeCanvas, sampleCanvas, toRGBA } from '../imgutil'
import type { KeyParams } from '../../../shared/types'

type Source = 'webcam' | 'dslr' | 'still'
const PW = 480

export default function GreenScreen() {
  const settings = useLoad(() => window.booth.settings.get())
  const scenes = useLoad(() => window.booth.library.scenes())
  const [toast, toastNode] = useToast()
  const [key, setKey] = useState<KeyParams | null>(null)
  const [source, setSource] = useState<Source>('webcam')
  const [frozen, setFrozen] = useState(false)
  const [camErr, setCamErr] = useState<string>()
  const [bg, setBg] = useState<string>('checker')
  const [bgUrl, setBgUrl] = useState<string>()
  const [report, setReport] = useState<(QualityReport & { coreTips: string[] }) | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [capMs, setCapMs] = useState<number>()
  const video = useRef<HTMLVideoElement>(null)
  const raw = useRef<HTMLCanvasElement>(null)
  const keyed = useRef<HTMLCanvasElement>(null)
  const frame = useRef<RGBAImage | null>(null)
  const aiImg = useRef<HTMLImageElement | null>(null)
  const keyRef = useRef<KeyParams | null>(null)
  const lastQ = useRef(0)

  useEffect(() => { if (settings.data && !key) setKey(structuredClone(settings.data.key)) }, [settings.data])
  keyRef.current = key
  const dirty = !!key && !!settings.data && JSON.stringify(key) !== JSON.stringify(settings.data.key)

  // background behind keyed pane
  useEffect(() => {
    if (bg === 'checker') { setBgUrl(undefined); return }
    const sc = scenes.data?.find(s => s.id === bg)
    if (sc) libImage(sc.file).then(setBgUrl).catch(() => setBgUrl(undefined))
  }, [bg, scenes.data])

  const process = useCallback((withQuality: boolean) => {
    const f = frame.current, k = keyRef.current, kc = keyed.current
    if (!f || !k || !kc) return
    kc.width = f.width; kc.height = f.height
    const g = kc.getContext('2d', { willReadFrequently: true })!
    let alpha: Uint8ClampedArray | undefined
    try {
      if (k.mode === 'ai' && aiImg.current) { g.clearRect(0, 0, f.width, f.height); g.drawImage(aiImg.current, 0, 0, f.width, f.height); alpha = g.getImageData(0, 0, f.width, f.height).data }
      else {
        const out = chromaKey(f, k)
        g.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0); alpha = out.data
      }
    } catch (e) { g.clearRect(0, 0, kc.width, kc.height); if (withQuality) setReport({ score: 0, label: 'poor', tips: ['keying engine error: ' + String((e as Error).message)], coreTips: [] }); return }
    if (!withQuality) return
    const r = tipsFromStats(analyzeFrame(f.data, f.width, f.height, k.keyColor, alpha))
    let coreTips: string[] = []
    try { coreTips = coreKeyQuality(f, k).tips.filter(t => !r.tips.includes(t)) } catch { /* optional */ }
    setReport({ ...r, coreTips })
  }, [])

  const setFrame = useCallback((src: CanvasImageSource) => {
    frame.current = toRGBA(src as any, PW)
    const rc = raw.current!, f = frame.current
    rc.width = f.width; rc.height = f.height
    rc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0)
  }, [])

  // webcam lifecycle
  useEffect(() => {
    if (source !== 'webcam') return
    let stream: MediaStream | undefined, alive = true
    setCamErr(undefined)
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr('no webcam api here — use "dslr still" or "load image"'); return }
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, deviceId: settings.data?.cameraId && !settings.data.cameraId.includes(':') ? { ideal: settings.data.cameraId } : undefined }, audio: false })
      .then(s => { if (!alive) return s.getTracks().forEach(t => t.stop()); stream = s; const v = video.current!; v.srcObject = s; return v.play() })
      .catch(e => alive && setCamErr(`webcam unavailable (${e?.name ?? e}). check permissions or pick another source.`))
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()) }
  }, [source, settings.data?.cameraId])

  // live loop
  useEffect(() => {
    if (source !== 'webcam' || frozen || camErr) return
    const t = setInterval(() => {
      const v = video.current
      if (!v || v.readyState < 2 || !v.videoWidth) return
      setFrame(v)
      const q = performance.now() - lastQ.current > 1000
      if (q) lastQ.current = performance.now()
      process(q)
    }, 140)
    return () => clearInterval(t)
  }, [source, frozen, camErr, setFrame, process])

  // re-process when params change on a still frame
  useEffect(() => { if (frame.current && (frozen || source !== 'webcam')) process(true) }, [key, frozen, source, process])

  const loadStill = async (src: string) => { const im = await loadImg(src); aiImg.current = null; setFrame(im); setFrozen(true); process(true) }
  const doCapture = async () => {
    const t0 = performance.now()
    try { const d = await window.booth.camera.capture(); setCapMs(Math.round(performance.now() - t0)); await loadStill(d) }
    catch (e) { toast('capture failed: ' + (e as Error).message) }
  }
  const sample = () => { aiImg.current = null; setFrame(sampleCanvas(640, 360)); setFrozen(true); process(true) }
  const upd = (p: Partial<KeyParams>) => setKey(k => (k ? { ...k, ...p } : k))

  const onSample = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const f = frame.current; if (!f) return
    const r = e.currentTarget.getBoundingClientRect()
    const s = Math.min(r.width / f.width, r.height / f.height)
    const ox = (r.width - f.width * s) / 2, oy = (r.height - f.height * s) / 2
    const x = Math.round((e.clientX - r.left - ox) / s), y = Math.round((e.clientY - r.top - oy) / s)
    if (x < 0 || y < 0 || x >= f.width || y >= f.height) return
    let R = 0, G = 0, B = 0, n = 0
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= f.width || yy >= f.height) continue
      const i = (yy * f.width + xx) * 4; R += f.data[i]; G += f.data[i + 1]; B += f.data[i + 2]; n++
    }
    upd({ keyColor: [Math.round(R / n), Math.round(G / n), Math.round(B / n)] })
    toast(`sampled ${rgbToHex([R / n, G / n, B / n])}`)
  }
  const auto = () => { try { if (frame.current) { upd({ keyColor: autoCalibrate(frame.current) }); toast('auto-calibrated from frame') } } catch (e) { toast('auto-calibrate failed: ' + (e as Error).message) } }
  const runAi = async () => {
    if (!frame.current) return
    setAiBusy(true)
    try { const png = await window.booth.ai.cutout(rgbaUrl(frame.current)); aiImg.current = await loadImg(png); process(true) }
    catch (e) { toast('ai cutout failed: ' + (e as Error).message) } finally { setAiBusy(false) }
  }
  const save = async () => { if (!key) return; await window.booth.settings.set({ key }); settings.reload(); toast('green screen settings saved') }

  if (!key) return <p className="ad-muted">loading…</p>
  const hex = rgbToHex(key.keyColor)
  const tone = report?.label === 'good' ? 'ok' : report?.label === 'ok' ? 'warn' : 'bad'
  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '1fr 380px', alignItems: 'start' }}>
      <div className="ad-grid">
        <div className="ad-card">
          <div className="ad-row sp" style={{ marginBottom: 12 }}>
            <Seg label="source" value={source} options={['webcam', 'dslr', 'still'] as const} onChange={s => { setSource(s); setFrozen(s !== 'webcam'); if (s === 'webcam') frame.current = null }} />
            <div className="ad-row">
              {source === 'webcam' && <button className="ad-btn sm ghost" onClick={() => setFrozen(f => !f)} disabled={!!camErr}>{frozen ? 'resume live' : 'freeze frame'}</button>}
              {source === 'dslr' && <button className="ad-btn sm" onClick={doCapture}>capture still{capMs ? ` · ${capMs} ms` : ''}</button>}
              <label className="ad-btn sm ghost" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>load image
                <input type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { setSource('still'); await loadStill(await fileToDataUrl(f)) } e.target.value = '' }} />
              </label>
              <button className="ad-btn sm ghost" onClick={() => { setSource('still'); sample() }}>sample image</button>
            </div>
          </div>
          {camErr && source === 'webcam' && <p className="ad-warn" role="alert">{camErr}</p>}
          <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="ad-view" style={{ aspectRatio: '16/9' }}>
              <canvas ref={raw} onClick={onSample} style={{ cursor: 'crosshair' }} aria-label="raw camera frame — click the green screen to sample its color" />
              <span className="ad-cap">raw · click green to sample</span>
              {!frame.current && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a8a8a8' }}>{source === 'webcam' ? 'waiting for camera…' : 'capture or load an image'}</div>}
            </div>
            <div className={`ad-view ${bg === 'checker' ? 'ad-checker' : ''}`} style={{ aspectRatio: '16/9', backgroundImage: bgUrl ? `url(${bgUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <canvas ref={keyed} aria-label="keyed result" />
              <span className="ad-cap">keyed · {key.mode}</span>
            </div>
          </div>
          <div className="ad-row" style={{ marginTop: 12 }}>
            <span className="ad-muted">preview over</span>
            <select className="ad-input" style={{ width: 220 }} aria-label="preview background" value={bg} onChange={e => setBg(e.target.value)}>
              <option value="checker">checkerboard</option>
              {(scenes.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="ad-chip"><b style={{ background: hex }} />key color {hex}</span>
            <button className="ad-btn sm ghost" onClick={auto} disabled={!frame.current}>auto-calibrate</button>
          </div>
        </div>
        {toastNode}
        <video ref={video} muted playsInline aria-hidden style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }} />
      </div>

      <div className="ad-grid">
        <div className="ad-card">
          <div className="ad-row sp"><h3 style={{ margin: 0 }}>key settings</h3>{dirty && <Chip tone="warn">unsaved</Chip>}</div>
          <div style={{ margin: '12px 0' }}><Seg label="mode" value={key.mode} options={['chroma', 'ai', 'auto'] as const} onChange={m => upd({ mode: m })} /></div>
          <p className="ad-muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
            {key.mode === 'chroma' ? 'fast green removal. best with even lighting.' : key.mode === 'ai' ? 'ai cutout for each photo. slower, works without a green screen.' : 'chroma first, falls back to ai when the screen looks poor.'}
          </p>
          <Slider label="similarity" value={key.similarity} onChange={v => upd({ similarity: v })} />
          <Slider label="smoothness" value={key.smoothness} onChange={v => upd({ smoothness: v })} />
          <Slider label="spill" value={key.spill} onChange={v => upd({ spill: v })} />
          <Slider label="edge shrink" value={key.edgeShrink} min={0} max={4} step={0.25} onChange={v => upd({ edgeShrink: v })} fmt={v => v.toFixed(1) + 'px'} />
          {key.mode === 'ai' && <button className="ad-btn sm" style={{ marginTop: 8 }} onClick={runAi} disabled={aiBusy || !frame.current}>{aiBusy ? 'working…' : 'run ai cutout on this frame'}</button>}
          <div className="ad-row" style={{ marginTop: 16 }}>
            <button className="ad-btn" onClick={save} disabled={!dirty}>save</button>
            <button className="ad-btn ghost" onClick={() => setKey(resetKey())}>reset to defaults</button>
            {dirty && <button className="ad-btn ghost sm" onClick={() => setKey(structuredClone(settings.data!.key))}>revert</button>}
          </div>
        </div>
        <div className="ad-card" aria-live="polite">
          <div className="ad-row sp"><h3 style={{ margin: 0 }}>key quality</h3>{report && <Chip tone={tone}>{report.label} · {report.score}</Chip>}</div>
          {report && <div className="ad-bar" style={{ margin: '12px 0' }} role="meter" aria-valuenow={report.score} aria-valuemin={0} aria-valuemax={100} aria-label="key quality score"><i style={{ width: report.score + '%', background: tone === 'ok' ? '#3ecf8e' : tone === 'warn' ? '#f5b942' : '#ff5c6c' }} /></div>}
          <ul className="ad-tips">{(report ? [...report.tips, ...report.coreTips] : ['capture or start the camera to see tips']).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      </div>
    </div>
  )
}

function rgbaUrl(f: RGBAImage): string {
  const c = makeCanvas(f.width, f.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0)
  return c.toDataURL('image/png')
}
