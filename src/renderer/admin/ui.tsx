import React, { useCallback, useEffect, useRef, useState } from 'react'

export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, fmt }: { label: string; value: number; min?: number; max?: number; step?: number; onChange(v: number): void; fmt?: (v: number) => string }) {
  const id = React.useId()
  return (
    <div className="ad-slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{fmt ? fmt(value) : value.toFixed(2)}</output>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label className="ad-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="tr" /> <span>{label}</span>
    </label>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange(v: T): void; label: string }) {
  return (
    <div className="ad-seg" role="radiogroup" aria-label={label}>
      {options.map(o => <button key={o} role="radio" aria-checked={o === value} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  )
}

export function Chip({ tone = 'idle', children }: { tone?: 'ok' | 'warn' | 'bad' | 'idle'; children: React.ReactNode }) {
  return <span className={`ad-chip ${tone}`}><b aria-hidden />{children}</span>
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="ad-field">{label}{children}</label>
}

export function Confirm({ title, body, yes = 'delete', onYes, onNo }: { title: string; body: string; yes?: string; onYes(): void; onNo(): void }) {
  return (
    <div className="ad-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onNo}>
      <div onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3><p className="ad-muted">{body}</p>
        <div className="ad-row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="ad-btn ghost" onClick={onNo} autoFocus>cancel</button>
          <button className="ad-btn danger" onClick={onYes}>{yes}</button>
        </div>
      </div>
    </div>
  )
}

/** transient toast */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const t = useRef<number>()
  const show = useCallback((m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 2600) }, [])
  const node = msg ? <div className="ad-toast" role="status">{msg}</div> : null
  return [show, node] as const
}

/** async loader with reload */
export function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList = []): { data?: T; error?: string; loading: boolean; reload(): void } {
  const [s, setS] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setS(p => ({ ...p, loading: true }))
    fn().then(data => live && setS({ data, loading: false })).catch(e => live && setS({ error: String(e?.message ?? e), loading: false }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...s, reload: () => setN(x => x + 1) }
}

/** image from library file path (cached per session) */
const imgCache = new Map<string, Promise<string>>()
export function libImage(file: string): Promise<string> {
  if (!imgCache.has(file)) imgCache.set(file, window.booth.library.imageUrl(file))
  return imgCache.get(file)!
}
export function invalidateLibImage(file: string) { imgCache.delete(file) }
export function LibImg({ file, className = 'ad-thumb', alt = '' }: { file?: string; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => { let l = true; setSrc(undefined); if (file) libImage(file).then(s => l && setSrc(s)).catch(() => {}); return () => { l = false } }, [file])
  return src ? <img className={className} src={src} alt={alt} draggable={false} /> : <div className={className} aria-hidden />
}

export function Wordmark() { return <span className="ad-word" aria-label="imagine">imagine<i /></span> }
