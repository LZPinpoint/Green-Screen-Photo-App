// Staff operator console: line a group up, capture, move on. Processing runs in the background pipeline.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type VenueSettings } from '../../shared/types'
import PinPad from '../kiosk/PinPad'
import Wordmark from '../kiosk/Wordmark'
import { useCamera } from '../kiosk/useCamera'
import LiveStage, { type StageHandle } from './LiveStage'
import { DetailPanel, HelpOverlay, QueuePanel, SceneStrip } from './Panels'
import { Pipeline, type Config, type Frame } from './pipeline'
import { createDisplayPublisher } from './displayBus'
import {
  actionForKey, BURST_FRAMES, BURST_GAP_MS, filterItems, keyLabel, normalizeStaff, sceneCategories, stepIndex, visibleScenes, type Health
} from './staffLogic'
import './staff.css'

const pref = {
  get(k: string, fb: boolean) { try { const v = localStorage.getItem(k); return v === null ? fb : v === '1' } catch { return fb } },
  set(k: string, v: boolean) { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* blocked */ } },
  str(k: string) { try { return localStorage.getItem(k) ?? undefined } catch { return undefined } },
  setStr(k: string, v: string | undefined) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* blocked */ } }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function loadConfig(): Promise<Config> {
  const b = window.booth
  const [settings, scenes, frames, layouts, cams, shareEnabled] = await Promise.all([
    b.settings.get().catch(() => DEFAULT_SETTINGS), b.library.scenes().catch(() => []), b.library.frames().catch(() => []),
    b.library.layouts().catch(() => []), b.camera.list().catch(() => []), Promise.resolve(b.share?.enabled?.()).then(v => !!v).catch(() => false)
  ])
  const layout = layouts.find(l => l.id === settings.defaultLayoutId) ?? layouts[0]
    ?? { id: 'fallback', name: 'classic', size: '4x6' as const, photosPerSheet: 1 as const, showLogo: true, qrCode: false }
  const cam = cams.find(c => c.id === settings.cameraId) ?? cams[0]
  return { settings: { ...settings, cameraId: cam?.id ?? settings.cameraId }, staff: normalizeStaff(settings.staff), scenes: scenes.filter(s => s.enabled), frames: frames.filter(f => f.enabled), layout, shareEnabled, camera: cam } as Config & { camera?: unknown }
}

export default function StaffApp({ onAdmin, onSwitchToKiosk }: { onAdmin(): void; onSwitchToKiosk(): void }) {
  const pipe = useMemo(() => new Pipeline(), [])
  const items = useSyncExternalStore(pipe.subscribe, pipe.getItems)
  const publisher = useMemo(() => createDisplayPublisher(), [])
  const [cfg, setCfg] = useState<(Config & { camera?: { id: string; kind: string } }) | null>(null)
  const [sceneId, setSceneId] = useState('')
  const [category, setCategory] = useState('all')
  const [frameId, setFrameId] = useState<string | undefined>(() => pref.str('imagine-staff-frame'))
  const [guides, setGuides] = useState(() => pref.get('imagine-staff-guides', false))
  const [burst, setBurst] = useState(() => pref.get('imagine-staff-burst', false))
  const [selectedKey, setSelectedKey] = useState<string>()
  const [query, setQuery] = useState('')
  const [help, setHelp] = useState(false)
  const [pin, setPin] = useState(false)
  const [health, setHealth] = useState<Health | null>(null)
  const [count, setCount] = useState(0)
  const [flashId, setFlashId] = useState(0)
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<'idle' | 'counting' | 'shooting'>('idle')
  const [status, setStatus] = useState('ready for the first group')
  const [undo, setUndo] = useState<{ label: string; run(): void } | null>(null)
  const [displayOpen, setDisplayOpen] = useState(false)
  const stage = useRef<StageHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cancel = useRef(false)
  const busy = useRef(false)
  const undoTimer = useRef(0)

  // ─── boot ───
  useEffect(() => {
    document.title = 'imagine · staff'
    pipe.onAnnounce = setStatus
    loadConfig().then(c => {
      pipe.configure(c); setCfg(c)
      setSceneId(c.scenes.find(s => s.id === c.staff.defaultSceneId)?.id ?? c.scenes[0]?.id ?? '')
      void pipe.load()
    })
    return () => { pipe.dispose(); publisher.close() }
  }, [pipe, publisher])
  useEffect(() => { if (cfg) pipe.configure(cfg) }, [cfg, pipe])

  const staff = cfg?.staff ?? normalizeStaff()
  const scenes = cfg?.scenes ?? []
  const categories = useMemo(() => sceneCategories(scenes), [scenes])
  const shown = useMemo(() => visibleScenes(scenes, category), [scenes, category])
  const scene = scenes.find(s => s.id === sceneId)
  const frame = cfg?.frames.find(f => f.id === frameId)
  const selected = items.find(i => i.key === selectedKey)
  const filtered = useMemo(() => filterItems(items, query, staff.ticketPrefix), [items, query, staff.ticketPrefix])
  const camDevice = cfg?.camera
  const camera = useCamera(!!cfg, camDevice?.kind === 'webcam' ? camDevice.id : undefined)
  const useVideo = (camDevice?.kind ?? 'webcam') === 'webcam'

  // ─── settings writes ───
  const saveStaff = useCallback(async (patch: Partial<typeof staff>) => {
    setCfg(c => c ? { ...c, staff: { ...c.staff, ...patch } } : c)
    try {
      const next: VenueSettings = await window.booth.settings.set({ staff: { ...staff, ...patch } })
      setCfg(c => c ? { ...c, settings: next, staff: normalizeStaff(next.staff) } : c)
    } catch { /* keep the on-screen value; it is saved the next time */ }
  }, [staff])
  const chooseScene = useCallback((id: string) => {
    setSceneId(id)
    void saveStaff({ defaultSceneId: id })
    const s = scenes.find(x => x.id === id); if (s) publisher.send({ type: 'scene', name: s.name })
  }, [saveStaff, scenes, publisher])
  const chooseFrame = (id: string | undefined) => { setFrameId(id); pref.setStr('imagine-staff-frame', id) }

  // second screen: tell it the scene whenever it (re)connects
  useEffect(() => {
    publisher.onHello = () => { setDisplayOpen(true); if (scene) publisher.send({ type: 'scene', name: scene.name }) }
    if (scene) publisher.send({ type: 'scene', name: scene.name })
  }, [publisher, scene])
  useEffect(() => { const t = window.setInterval(() => setDisplayOpen(publisher.listening), 2000); return () => window.clearInterval(t) }, [publisher])
  const openDisplay = () => { window.open(location.href.split('#')[0] + '#/display', 'imagine-display'); setStatus('guest display opened — drag it to the second screen, double-click for fullscreen') }

  // ─── capture ───
  const showNext = useCallback(() => {
    publisher.send({ type: 'next', text: 'next group, please' })
    window.setTimeout(() => publisher.send({ type: 'next', text: '' }), 3500)
  }, [publisher])

  const capture = useCallback(async () => {
    if (busy.current || !cfg || !scene || !camera.stream) return
    busy.current = true; cancel.current = false
    setSelectedKey(undefined); setUndo(null)
    try {
      publisher.send({ type: 'next', text: '' })
      for (let n = staff.countdownSec; n > 0; n--) {
        setPhase('counting'); setCount(n); publisher.send({ type: 'countdown', n })
        await sleep(1000)
        if (cancel.current) { setCount(0); publisher.send({ type: 'countdown', n: 0 }); setStatus('capture cancelled'); return }
      }
      setCount(0); publisher.send({ type: 'countdown', n: 0 })
      setPhase('shooting')
      const frames: Frame[] = []
      const total = burst ? BURST_FRAMES : 1
      for (let i = 0; i < total; i++) {
        setFlashId(f => f + 1); publisher.send({ type: 'flash' })
        frames.push(await stage.current!.grab())
        if (i < total - 1) { setNote(`hold still ${i + 2}/${total}`); await sleep(BURST_GAP_MS) }
      }
      setNote('')
      pipe.capture(frames, scene.id, frameId)
      showNext()
    } catch {
      setStatus('the camera needs a hand — check the cable, then try again')
    } finally { busy.current = false; setPhase('idle'); setNote('') }
  }, [cfg, scene, camera.stream, staff.countdownSec, burst, frameId, pipe, publisher, showNext])

  // ─── item actions ───
  const printSel = useCallback(() => {
    const it = selected ?? items[0]
    if (it?.compositePath && !it.busy) void pipe.print(it.key)
  }, [selected, items, pipe])
  const retake = useCallback(() => {
    const it = selected ?? items[0]; if (!it) return
    const snapshot = it
    pipe.remove(it.key); setSelectedKey(undefined)
    setStatus(`${pipe.ticketLabel(it.ticket)} removed — line the group up again`)
    window.clearTimeout(undoTimer.current)
    setUndo({ label: `undo retake of ${pipe.ticketLabel(it.ticket)}`, run: () => { pipe.restore(snapshot); setUndo(null) } })
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000)
  }, [selected, items, pipe])
  const step = useCallback((dir: -1 | 1) => {
    const idx = filtered.findIndex(i => i.key === selectedKey)
    const n = idx < 0 ? (dir === 1 ? 0 : filtered.length - 1) : Math.min(filtered.length - 1, Math.max(0, idx + dir))
    if (filtered[n]) setSelectedKey(filtered[n].key)
  }, [filtered, selectedKey])

  // ─── hotkeys ───
  useEffect(() => {
    const typing = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable) }
    const down = (e: KeyboardEvent) => {
      if (pin || e.ctrlKey || e.metaKey || e.altKey) return
      const a = actionForKey(e.key, staff.captureKey, typing(e.target))
      if (!a) return
      if (a.type === 'capture') { e.preventDefault(); if (!e.repeat) void capture(); return }
      if (e.key !== 'Escape') e.preventDefault()
      switch (a.type) {
        case 'escape':
          if (help) setHelp(false); else if (busy.current) cancel.current = true; else if (selectedKey) setSelectedKey(undefined)
          else if (typing(e.target)) (e.target as HTMLElement).blur()
          break
        case 'help': setHelp(h => !h); break
        case 'print': printSel(); break
        case 'retake': retake(); break
        case 'queueStep': step(a.dir); break
        case 'focusSearch': searchRef.current?.focus(); searchRef.current?.select(); break
        case 'scene': {
          const s = shown[a.index]; if (!s) break
          if (selected) void pipe.recompose(selected.key, { sceneId: s.id }); else chooseScene(s.id)
          break
        }
        case 'sceneStep': {
          const cur = selected ? selected.sceneId : sceneId
          const s = shown[stepIndex(shown.length, shown.findIndex(x => x.id === cur), a.dir)]; if (!s) break
          if (selected) void pipe.recompose(selected.key, { sceneId: s.id }); else chooseScene(s.id)
          break
        }
      }
    }
    // a space/enter keyup would otherwise "click" whichever button has focus right after a capture
    const up = (e: KeyboardEvent) => { if (e.key === staff.captureKey && !typing(e.target)) e.preventDefault() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [staff.captureKey, capture, help, pin, selected, selectedKey, shown, sceneId, chooseScene, printSel, retake, step, pipe])

  const toggle = (set: (v: boolean) => void, key: string) => (v: boolean) => { set(v); pref.set(key, v) }
  const capDisabled = !camera.stream || !scene || phase !== 'idle'
  const canCapture = !!scene
  const nextLabel = pipe.nextTicketLabel()

  if (!cfg) return <div className="st-app st-boot" role="status"><Wordmark size={64} /><p>getting the booth ready…</p></div>

  return (
    <div className="st-app" style={cfg.settings.brand?.accent ? ({ '--im-red': cfg.settings.brand.accent } as React.CSSProperties) : undefined}>
      <header className="st-bar">
        <div className="st-brand"><Wordmark size={30} /><span className="st-tag">staff</span></div>
        <div className="st-bar-actions">
          <button className="st-bar-btn" onClick={openDisplay} aria-label="open guest display on the second screen"><span aria-hidden="true">▢</span> guest display{displayOpen && <i className="st-live" aria-label="connected" />}</button>
          <button className="st-bar-btn" onClick={() => setHelp(true)} aria-label="keyboard shortcuts">?</button>
          <button className="st-bar-btn" onClick={onSwitchToKiosk}>self-serve</button>
          <button className="st-bar-btn" onClick={() => setPin(true)}>admin</button>
        </div>
      </header>

      <main className="st-main">
        <QueuePanel items={filtered} total={items.length} selectedKey={selectedKey} onSelect={k => setSelectedKey(k === selectedKey ? undefined : k)}
          query={query} onQuery={setQuery} searchRef={searchRef} ticketLabel={n => pipe.ticketLabel(n)} nextLabel={nextLabel} />

        <div className="st-work">
          <LiveStage ref={stage} stream={camera.stream} useVideo={useVideo} keyParams={cfg.settings.key} scene={scene} frame={frame}
            guides={guides} count={count} flashId={flashId} note={note} getEngine={() => pipe.engineReady()} publisher={publisher} onHealth={setHealth} />

          <div className="st-side">
            <button className={`st-capture${phase !== 'idle' ? ' busy' : ''}`} onClick={() => void capture()} disabled={capDisabled} aria-keyshortcuts={staff.captureKey === ' ' ? 'Space' : staff.captureKey}>
              <span className="st-cap-main">{phase === 'counting' ? `get ready… ${count}` : phase === 'shooting' ? (burst ? 'hold still…' : 'got it') : 'capture'}</span>
              <span className="st-cap-sub">{canCapture ? <>press <kbd>{keyLabel(staff.captureKey)}</kbd> · {staff.countdownSec > 0 ? `${staff.countdownSec}s countdown` : 'instant'}{burst ? ' · burst of 3' : ''}</> : 'add a scene in admin first'}</span>
            </button>
            <p className="st-status" role="status" aria-live="polite">{status}</p>
            {undo && <button className="st-btn ghost st-undo" onClick={undo.run}>{undo.label}</button>}

            <div className={`st-health lvl-${health?.level ?? 'idle'}`} role="status" aria-live="polite">
              <i aria-hidden="true" />
              <span>{health ? health.text : 'checking the green screen…'}</span>
            </div>

            <div className="st-toggles" role="group" aria-label="lineup options">
              <Toggle label="guides" hint="framing lines" on={guides} onChange={toggle(setGuides, 'imagine-staff-guides')} />
              <Toggle label="burst of 3" hint="pick best later" on={burst} onChange={toggle(setBurst, 'imagine-staff-burst')} />
              <Toggle label="auto-print" hint="when ready" on={staff.autoPrint} onChange={v => void saveStaff({ autoPrint: v })} />
              <div className="st-toggle st-count-row">
                <span>countdown<small>{staff.countdownSec === 0 ? 'instant' : `${staff.countdownSec} seconds`}</small></span>
                <div className="st-stepper" role="group" aria-label="countdown seconds">
                  <button aria-label="shorter countdown" onClick={() => void saveStaff({ countdownSec: Math.max(0, staff.countdownSec - 1) })} disabled={staff.countdownSec <= 0}>−</button>
                  <b>{staff.countdownSec}</b>
                  <button aria-label="longer countdown" onClick={() => void saveStaff({ countdownSec: Math.min(10, staff.countdownSec + 1) })} disabled={staff.countdownSec >= 10}>+</button>
                </div>
              </div>
            </div>
            {cfg.frames.length > 0 && (
              <div className="st-frames" role="group" aria-label="frame for the next capture">
                <button className="st-pill" aria-pressed={!frameId} onClick={() => chooseFrame(undefined)}>no frame</button>
                {cfg.frames.map(f => <button key={f.id} className="st-pill" aria-pressed={frameId === f.id} onClick={() => chooseFrame(f.id)}>{f.name}</button>)}
              </div>
            )}
          </div>

          {selected && (
            <DetailPanel item={selected} scenes={shown} categories={categories} category={category} onCategory={setCategory} frames={cfg.frames}
              ticketLabel={n => pipe.ticketLabel(n)} onClose={() => setSelectedKey(undefined)}
              onScene={id => void pipe.recompose(selected.key, { sceneId: id })} onFrame={id => void pipe.recompose(selected.key, { frameId: id })}
              onBest={n => void pipe.recompose(selected.key, { best: n })} onLabel={s => pipe.setLabel(selected.key, s)}
              onCopies={n => pipe.setCopies(selected.key, n)} onPrint={printSel} onRetry={() => void pipe.retry(selected.key)}
              onRetake={retake} onDelete={() => { pipe.remove(selected.key); setSelectedKey(undefined) }}
              loadFull={() => pipe.fullSheet(selected.key)} loadShots={() => void pipe.loadShotThumbs(selected.key)} />
          )}
        </div>
      </main>

      {!selected && <SceneStrip scenes={shown} categories={categories} category={category} onCategory={setCategory} selectedId={sceneId} onSelect={chooseScene} title="scene for the next group" />}

      {help && <HelpOverlay captureKey={staff.captureKey} onClose={() => setHelp(false)} />}
      {pin && <PinPad onCancel={() => setPin(false)} onOk={() => { setPin(false); onAdmin() }} />}
    </div>
  )
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange(v: boolean): void }) {
  return (
    <button className={`st-toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <i aria-hidden="true" />
    </button>
  )
}
