import { useEffect, useMemo, useState } from 'react'
import { assetUrl } from './assets'
import SceneCanvas from './SceneCanvas'
import type { Cfg, Shot } from './types'

function Thumb({ file, name }: { file: string; name: string }) {
  const [u, setU] = useState('')
  useEffect(() => { let d = false; assetUrl(file).then(x => { if (!d) setU(x) }).catch(() => {}); return () => { d = true } }, [file])
  return <span className="thumb" style={u ? { backgroundImage: `url(${u})` } : undefined}><em>{name}</em></span>
}

export default function ScenesScreen({ cfg, shots, sceneId, frameId, onPickScene, onPickFrame, onNext, onBack }: {
  cfg: Cfg; shots: Shot[]; sceneId?: string; frameId?: string
  onPickScene: (id: string) => void; onPickFrame: (id?: string) => void; onNext: () => void; onBack: () => void
}) {
  const cats = useMemo(() => ['all', ...Array.from(new Set(cfg.scenes.map(s => s.category)))], [cfg.scenes])
  const [cat, setCat] = useState('all')
  const scene = cfg.scenes.find(s => s.id === sceneId)
  const frame = cfg.frames.find(f => f.id === frameId)
  const list = cfg.scenes.filter(s => cat === 'all' || s.category === cat)
  const n = shots.length

  return (
    <main className="k-screen k-scenes">
      <div className="scenes-stage im-card" data-count={n}>
        {shots.map((s, i) => (
          <SceneCanvas key={i} keyed={s.keyed} scene={scene} frameFile={frame?.file} className="scenes-canvas" />
        ))}
      </div>
      <div className="scenes-panel">
        <h2>pick your world</h2>
        <div className="chips" role="tablist">
          {cats.map(c => <button key={c} className={`chip ${c === cat ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="scene-grid">
          {list.map(s => (
            <button key={s.id} className={`scene-btn ${s.id === sceneId ? 'on' : ''}`} onClick={() => onPickScene(s.id)} aria-label={s.name}>
              <Thumb file={s.file} name={s.name} />
            </button>
          ))}
        </div>
        {cfg.frames.length > 0 && (
          <div className="frames">
            <span className="label">frame</span>
            <div className="chips">
              <button className={`chip ${!frameId ? 'on' : ''}`} onClick={() => onPickFrame(undefined)}>none</button>
              {cfg.frames.map(f => <button key={f.id} className={`chip ${f.id === frameId ? 'on' : ''}`} onClick={() => onPickFrame(f.id)}>{f.name}</button>)}
            </div>
          </div>
        )}
        <div className="row">
          <button className="im-btn ghost" onClick={onBack}>back</button>
          <button className="im-btn big" onClick={onNext} disabled={!sceneId}>see my print</button>
        </div>
      </div>
    </main>
  )
}
