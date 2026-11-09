// Staff console panels: scene strip, queue, detail drawer, help overlay.
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { BackgroundScene, FrameOverlay } from '../../shared/types'
import { assetUrl } from '../kiosk/assets'
import { clockLabel, itemStatus, keyLabel } from './staffLogic'
import type { Item } from './pipeline'

export function Chip({ item }: { item: Pick<Item, 'busy' | 'status' | 'failed' | 'printed' | 'sharing'> }) {
  const s = itemStatus(item)
  return <span className={`st-chip tone-${s.tone}`} data-status={s.key}>{s.tone === 'busy' && <i className="st-spin" aria-hidden="true" />}{s.label}</span>
}

// ─── scenes ───
function SceneThumb({ scene }: { scene: BackgroundScene }) {
  const [src, setSrc] = useState('')
  useEffect(() => { let d = false; assetUrl(scene.thumb || scene.file).then(u => { if (!d) setSrc(u) }).catch(() => {}); return () => { d = true } }, [scene.thumb, scene.file])
  return src ? <img src={src} alt="" draggable={false} /> : <span className="st-ph" />
}

export function SceneStrip({ scenes, categories, category, onCategory, selectedId, onSelect, numbered = true, title }: {
  scenes: BackgroundScene[]; categories: string[]; category: string; onCategory(c: string): void
  selectedId?: string; onSelect(id: string): void; numbered?: boolean; title: string
}) {
  const sel = useRef<HTMLButtonElement>(null)
  useEffect(() => { sel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [selectedId])
  return (
    <section className="st-scenes" aria-label={title}>
      <div className="st-scenes-head">
        <b>{title}</b>
        {categories.length > 1 && (
          <div className="st-cats" role="group" aria-label="scene categories">
            {['all', ...categories].map(c => <button key={c} className="st-pill" aria-pressed={category === c} onClick={() => onCategory(c)}>{c}</button>)}
          </div>
        )}
      </div>
      <div className="st-scene-row" role="listbox" aria-label={title}>
        {scenes.map((s, i) => (
          <button key={s.id} ref={s.id === selectedId ? sel : undefined} role="option" aria-selected={s.id === selectedId} aria-label={`${s.name}${numbered && i < 9 ? `, key ${i + 1}` : ''}`}
            className={`st-scene${s.id === selectedId ? ' on' : ''}`} onClick={() => onSelect(s.id)}>
            <SceneThumb scene={s} />
            {numbered && i < 9 && <kbd>{i + 1}</kbd>}
            <span className="st-scene-name">{s.name}</span>
          </button>
        ))}
        {scenes.length === 0 && <p className="st-empty">no scenes here yet — add some in admin → scenes</p>}
      </div>
    </section>
  )
}

// ─── queue ───
export function QueuePanel({ items, selectedKey, onSelect, query, onQuery, searchRef, ticketLabel, total, nextLabel }: {
  items: Item[]; selectedKey?: string; onSelect(key: string): void; query: string; onQuery(q: string): void
  searchRef: RefObject<HTMLInputElement>; ticketLabel(n?: number): string; total: number; nextLabel: string
}) {
  return (
    <aside className="st-queue" aria-label="today's captures">
      <div className="st-queue-head">
        <div><b>today</b> <span className="st-dim">{total}</span></div>
        <span className="st-dim">next <b className="st-ticket sm">{nextLabel}</b></span>
      </div>
      <label className="st-search">
        <span className="sr-only">find a ticket number or name</span>
        <input ref={searchRef} type="search" inputMode="search" placeholder="find a ticket  (f)" value={query} onChange={e => onQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && items[0]) { e.preventDefault(); onSelect(items[0].key) } }} />
      </label>
      <ul className="st-q-list">
        {items.map(i => (
          <li key={i.key}>
            <button className={`st-q-item${i.key === selectedKey ? ' on' : ''}`} onClick={() => onSelect(i.key)} aria-pressed={i.key === selectedKey}
              aria-label={`${ticketLabel(i.ticket)}${i.label ? ' ' + i.label : ''}, ${clockLabel(i.createdAt)}, ${itemStatus(i).label}`}>
              <span className="st-q-thumb">{i.thumb ? <img src={i.thumb} alt="" draggable={false} /> : <i className="st-spin big" aria-hidden="true" />}</span>
              <span className="st-q-meta">
                <span className="st-q-top"><b className="st-ticket">{ticketLabel(i.ticket)}</b><span className="st-dim">{clockLabel(i.createdAt)}</span></span>
                {i.label && <span className="st-q-label">{i.label}</span>}
                <Chip item={i} />
              </span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="st-empty">{total ? 'nothing matches that search' : 'no captures yet — line up the first group and press capture'}</li>}
      </ul>
    </aside>
  )
}

// ─── detail drawer ───
export function DetailPanel({ item, scenes, categories, category, onCategory, frames, ticketLabel, onClose, onScene, onFrame, onBest, onLabel, onCopies, onPrint, onRetry, onRetake, onDelete, loadFull, loadShots }: {
  item: Item; scenes: BackgroundScene[]; categories: string[]; category: string; onCategory(c: string): void; frames: FrameOverlay[]
  ticketLabel(n?: number): string; onClose(): void
  onScene(id: string): void; onFrame(id: string | null): void; onBest(n: number): void; onLabel(s: string): void; onCopies(n: number): void
  onPrint(): void; onRetry(): void; onRetake(): void; onDelete(): void
  loadFull(): Promise<string | undefined>; loadShots(): void
}) {
  const [full, setFull] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const [label, setLabel] = useState(item.label)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setLabel(item.label); setConfirm(false); setFull(undefined) }, [item.key])
  useEffect(() => { closeRef.current?.focus() }, [item.key])
  useEffect(() => { loadShots() }, [item.key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let d = false
    if (item.busy || !item.compositePath) return
    loadFull().then(u => { if (!d && u) setFull(u) })
    return () => { d = true }
  }, [item.key, item.compositePath, item.thumb]) // eslint-disable-line react-hooks/exhaustive-deps
  const shotThumbs = item.shots.map((s, n) => ({ n, thumb: s.thumb }))
  const canPrint = !!item.compositePath && !item.busy
  return (
    <section className="st-detail" aria-label={`details for ${ticketLabel(item.ticket)}`}>
      <header className="st-detail-head">
        <h2><span className="st-ticket">{ticketLabel(item.ticket)}</span> <span className="st-dim">{clockLabel(item.createdAt)}</span></h2>
        <Chip item={item} />
        <button ref={closeRef} className="st-btn ghost" onClick={onClose} aria-label="close details (esc)">close · esc</button>
      </header>
      <div className="st-detail-body">
        <div className="st-sheet" aria-live="polite">
          {(full || item.thumb) ? <img src={full ?? item.thumb} alt={`print for ${ticketLabel(item.ticket)}`} /> : <div className="st-sheet-empty"><i className="st-spin big" aria-hidden="true" />building the picture…</div>}
          {item.busy === 'processing' && <div className="st-sheet-busy"><i className="st-spin big" aria-hidden="true" />updating…</div>}
        </div>
        <div className="st-detail-side">
         <div className="st-detail-scroll">
          {item.failed && (
            <div className="st-fail" role="alert">
              <b>{item.failed.stage === 'print' ? "that didn't print" : "that didn't finish"}</b>
              <span>{item.failed.msg}</span>
              <button className="st-btn" onClick={onRetry}>retry</button>
            </div>
          )}
          <div className="st-row">
            <button className="st-btn big" onClick={onPrint} disabled={!canPrint}>{item.printed > 0 ? 'reprint' : 'print'} · {item.copies}× <kbd>p</kbd></button>
            <div className="st-stepper" role="group" aria-label="copies">
              <button aria-label="fewer copies" onClick={() => onCopies(item.copies - 1)} disabled={item.copies <= 1}>−</button>
              <b aria-live="polite">{item.copies}</b>
              <button aria-label="more copies" onClick={() => onCopies(item.copies + 1)} disabled={item.copies >= 10}>+</button>
            </div>
          </div>
          <label className="st-field">
            <span>name or note on this ticket</span>
            <input type="text" value={label} maxLength={40} placeholder="e.g. smith family" onChange={e => setLabel(e.target.value)}
              onBlur={() => label !== item.label && onLabel(label.trim())}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          </label>
          {item.shots.length > 1 && (
            <div className="st-burst" role="group" aria-label="pick the best frame">
              <span className="st-dim">pick the best frame — nobody blinking</span>
              <div className="st-burst-row">
                {shotThumbs.map(s => (
                  <button key={s.n} className={`st-shot${item.best === s.n ? ' on' : ''}`} aria-pressed={item.best === s.n} aria-label={`frame ${s.n + 1}${item.best === s.n ? ', chosen' : ''}`} onClick={() => onBest(s.n)}>
                    {s.thumb ? <img src={s.thumb} alt="" draggable={false} /> : <span className="st-ph" />}
                    <em>{item.best === s.n ? 'best' : s.n + 1}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
          <SceneStrip scenes={scenes} categories={category === 'all' ? [] : categories} category={category} onCategory={onCategory} selectedId={item.sceneId} onSelect={onScene} title="change scene (1–9)" />
          {frames.length > 0 && (
            <div className="st-frames" role="group" aria-label="frame">
              <button className="st-pill" aria-pressed={!item.frameId} onClick={() => onFrame(null)}>no frame</button>
              {frames.map(f => <button key={f.id} className="st-pill" aria-pressed={item.frameId === f.id} onClick={() => onFrame(f.id)}>{f.name}</button>)}
            </div>
          )}
         </div>
          <div className="st-row end st-detail-foot">
            {!confirm ? (<>
              <button className="st-btn ghost" onClick={onRetake}>retake <kbd>r</kbd></button>
              <button className="st-btn ghost danger" onClick={() => setConfirm(true)}>delete</button>
            </>) : (<>
              <span className="st-confirm" role="alert">delete {ticketLabel(item.ticket)}?</span>
              <button className="st-btn danger" onClick={onDelete}>yes, delete</button>
              <button className="st-btn ghost" onClick={() => setConfirm(false)}>keep it</button>
            </>)}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── help ───
export function HelpOverlay({ captureKey, onClose }: { captureKey: string; onClose(): void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const rows: [string, string, string][] = [
    [keyLabel(captureKey), 'capture the group', 'big capture button'],
    ['1 – 9', 'pick a scene', 'tap a scene'],
    ['← →', 'previous / next scene', 'scroll the scene strip'],
    ['p', 'print the selected capture', 'print button in details'],
    ['r', 'retake the last capture', 'retake in details'],
    ['[  ]', 'previous / next capture in the list', 'tap a capture'],
    ['f', 'find a ticket number', 'tap the search box'],
    ['esc', 'close details, cancel a countdown', 'close button'],
    ['?', 'this help', '? button in the top bar']
  ]
  return (
    <div className="st-modal" role="dialog" aria-modal="true" aria-label="keyboard shortcuts" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card">
        <h2>shortcuts</h2>
        <table>
          <thead><tr><th scope="col">key</th><th scope="col">does</th><th scope="col">touch</th></tr></thead>
          <tbody>{rows.map(([k, a, t]) => <tr key={a}><td><kbd>{k}</kbd></td><td>{a}</td><td className="st-dim">{t}</td></tr>)}</tbody>
        </table>
        <p className="st-dim">a presenter clicker works too — set its button as the capture key in admin → settings.</p>
        <button ref={ref} className="st-btn" onClick={onClose}>got it</button>
      </div>
    </div>
  )
}
