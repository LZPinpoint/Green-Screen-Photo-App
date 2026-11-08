import React, { useEffect, useRef, useState } from 'react'
import { Chip, Confirm, Field, LibImg, Slider, Toggle, invalidateLibImage, libImage, useLoad, useToast } from '../ui'
import { fileToDataUrl } from '../imgutil'
import type { BackgroundScene, FrameOverlay } from '../../../shared/types'

/** Person silhouette in unit space: feet at (0,0), total height 1. */
export function Silhouette({ x, y, scale, W = 100, H = 150, fill = '#fff' }: { x: number; y: number; scale: number; W?: number; H?: number; fill?: string }) {
  return (
    <g transform={`translate(${x * W} ${y * H}) scale(${scale * H})`} fill={fill} opacity=".6">
      <circle cx="0" cy="-0.91" r="0.09" />
      <rect x="-0.17" y="-0.78" width="0.34" height="0.42" rx="0.1" />
      <rect x="-0.12" y="-0.42" width="0.24" height="0.42" rx="0.04" />
    </g>
  )
}

export function AnchorPreview({ file, anchor, onChange, frameFile }: { file: string; anchor: BackgroundScene['anchor']; onChange?(a: BackgroundScene['anchor']): void; frameFile?: string }) {
  const [src, setSrc] = useState<string>()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  useEffect(() => { let l = true; libImage(file).then(s => l && setSrc(s)).catch(() => {}); return () => { l = false } }, [file])
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !onChange || !box.current) return
    const r = box.current.getBoundingClientRect()
    onChange({ ...anchor, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0.2, (e.clientY - r.top) / r.height)) })
  }
  const key = (e: React.KeyboardEvent) => {
    if (!onChange) return
    const d = e.shiftKey ? 0.05 : 0.01
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }
    const v = m[e.key]; if (!v) return
    e.preventDefault(); onChange({ ...anchor, x: Math.min(1, Math.max(0, anchor.x + v[0])), y: Math.min(1, Math.max(0.2, anchor.y + v[1])) })
  }
  return (
    <div ref={box} className="ad-view" tabIndex={onChange ? 0 : undefined} role={onChange ? 'slider' : 'img'} aria-label={`subject anchor x ${anchor.x.toFixed(2)} y ${anchor.y.toFixed(2)}. drag or use arrow keys`}
      style={{ aspectRatio: '2/3', width: '100%', cursor: onChange ? 'grab' : 'default', touchAction: 'none', backgroundImage: src ? `url(${src})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
      onPointerDown={e => { drag.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e) }} onPointerMove={move} onPointerUp={() => { drag.current = false }} onKeyDown={key}>
      <svg viewBox="0 0 100 150" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <Silhouette {...anchor} fill="#fff" />
        <circle cx={anchor.x * 100} cy={anchor.y * 150} r="2.2" fill="#e0153b" stroke="#fff" strokeWidth=".6" />
      </svg>
      {frameFile && <LibImg file={frameFile} className="" alt="" />}
    </div>
  )
}

const slug = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

export default function Scenes() {
  const scenes = useLoad(() => window.booth.library.scenes())
  const frames = useLoad(() => window.booth.library.frames())
  const [sel, setSel] = useState<string>()
  const [draft, setDraft] = useState<BackgroundScene>()
  const [confirm, setConfirm] = useState(false)
  const [toast, toastNode] = useToast()

  useEffect(() => { const s = scenes.data?.find(x => x.id === sel); setDraft(s ? structuredClone(s) : undefined) }, [sel, scenes.data])
  useEffect(() => { if (!sel && scenes.data?.length) setSel(scenes.data[0].id) }, [scenes.data])

  const orig = scenes.data?.find(s => s.id === sel)
  const dirty = !!draft && !!orig && JSON.stringify(draft) !== JSON.stringify(orig)
  const cats = Array.from(new Set((scenes.data ?? []).map(s => s.category)))

  const save = async (s = draft, img?: string) => { if (!s) return; await window.booth.library.saveScene(s, img); if (img) invalidateLibImage(s.file); scenes.reload(); toast('scene saved') }
  const upload = async (f: File, replace?: BackgroundScene) => {
    const url = await fileToDataUrl(f)
    if (replace) { await save(replace, url); return }
    const id = 'scene-' + slug()
    const s: BackgroundScene = { id, name: f.name.replace(/\.[^.]+$/, '').toLowerCase(), category: cats[0] ?? 'new', file: `backgrounds/${id}.jpg`, anchor: { x: 0.5, y: 0.97, scale: 0.8 }, enabled: true }
    await save(s, url); setSel(id)
  }
  const del = async () => { if (!draft) return; await window.booth.library.deleteScene(draft.id); setConfirm(false); setSel(undefined); scenes.reload(); toast('scene deleted') }
  const toggleFrame = async (f: FrameOverlay) => {
    try { await window.booth.library.saveFrame({ ...f, enabled: !f.enabled }); frames.reload() } catch (e) { toast('could not save frame: ' + (e as Error).message) }
  }

  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '1fr 380px', alignItems: 'start' }}>
      <div className="ad-grid">
        <div className="ad-card">
          <div className="ad-row sp" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>scenes <span className="ad-muted">· {scenes.data?.filter(s => s.enabled).length ?? 0} of {scenes.data?.length ?? 0} on</span></h3>
            <label className="ad-btn sm" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>upload scene image
              <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f).catch(err => toast(String(err.message))); e.target.value = '' }} />
            </label>
          </div>
          <div className="ad-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {(scenes.data ?? []).map(s => (
              <button key={s.id} className={`ad-tile ${s.enabled ? '' : 'off'}`} aria-pressed={sel === s.id} onClick={() => setSel(s.id)}>
                <LibImg file={s.file} alt={s.name} />
                <div>{s.name}<br /><span className="ad-muted" style={{ fontSize: 12 }}>{s.category}{s.enabled ? '' : ' · hidden'}</span></div>
              </button>
            ))}
          </div>
          {scenes.data?.length === 0 && <p className="ad-muted">no scenes yet — upload a background image to start.</p>}
        </div>
        <div className="ad-card">
          <h3>frames <span className="ad-muted">· transparent png overlays</span></h3>
          <div className="ad-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
            {(frames.data ?? []).map(f => (
              <div key={f.id} className={`ad-tile ${f.enabled ? '' : 'off'}`} style={{ cursor: 'default' }}>
                <div className="ad-checker" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}><LibImg file={f.file} alt={f.name} className="ad-thumb frame" /></div>
                <div>{f.name}</div>
                <Toggle checked={f.enabled} onChange={() => toggleFrame(f)} label={f.enabled ? 'on' : 'off'} />
              </div>
            ))}
            {frames.data?.length === 0 && <p className="ad-muted">no frames installed. drop transparent pngs into the frames folder of the data directory.</p>}
          </div>
        </div>
      </div>

      <div className="ad-card" style={{ position: 'sticky', top: 0 }}>
        {draft ? (
          <>
            <div className="ad-row sp"><h3 style={{ margin: 0 }}>edit scene</h3>{dirty && <Chip tone="warn">unsaved</Chip>}</div>
            <div className="ad-grid" style={{ gridTemplateColumns: '170px 1fr', marginTop: 12, gap: 14 }}>
              <div>
                <AnchorPreview file={draft.file} anchor={draft.anchor} onChange={a => setDraft({ ...draft, anchor: a })} />
                <p className="ad-muted" style={{ fontSize: 12 }}>drag to place the guest's feet</p>
              </div>
              <div className="ad-grid" style={{ gap: 10, alignContent: 'start' }}>
                <Field label="name"><input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
                <Field label="category"><input type="text" list="cats" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></Field>
                <datalist id="cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
                <Toggle checked={draft.enabled} onChange={v => setDraft({ ...draft, enabled: v })} label="shown to guests" />
              </div>
            </div>
            <Slider label="size" value={draft.anchor.scale} min={0.2} max={1.2} onChange={v => setDraft({ ...draft, anchor: { ...draft.anchor, scale: v } })} fmt={v => Math.round(v * 100) + '%'} />
            <div className="ad-row" style={{ marginTop: 8 }}>
              <button className="ad-btn" onClick={() => save()} disabled={!dirty}>save</button>
              <label className="ad-btn ghost" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>replace image
                <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, draft).catch(err => toast(String(err.message))); e.target.value = '' }} />
              </label>
              <button className="ad-btn danger" onClick={() => setConfirm(true)}>delete</button>
            </div>
          </>
        ) : <p className="ad-muted">pick a scene to edit it.</p>}
      </div>
      {confirm && draft && <Confirm title={`delete "${draft.name}"?`} body="the scene and its image are removed. past sessions keep their photos." onYes={del} onNo={() => setConfirm(false)} />}
      {toastNode}
    </div>
  )
}
