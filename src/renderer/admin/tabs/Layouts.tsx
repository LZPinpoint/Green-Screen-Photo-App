import React, { useEffect, useRef, useState } from 'react'
import { Chip, Field, Toggle, useLoad, useToast } from '../ui'
import { SIZE_PX } from '../helpers'
import { qrMatrix, sheet } from '../coreAdapter'
import { drawSilhouette, makeCanvas, rgbaToCanvas, toRGBA } from '../imgutil'
import type { PrintLayout } from '../../../shared/types'


function sampleShot(i: number): HTMLCanvasElement {
  const c = makeCanvas(600, 400), g = c.getContext('2d')!
  const gr = g.createLinearGradient(0, 0, 600, 400)
  const pal = [['#2b5876', '#4e4376'], ['#b80021', '#3a0a14'], ['#134e5e', '#71b280'], ['#614385', '#516395']][i % 4]
  gr.addColorStop(0, pal[0]); gr.addColorStop(1, pal[1]); g.fillStyle = gr; g.fillRect(0, 0, 600, 400)
  drawSilhouette(g, 300 + (i - 1) * 40, 392, 320, '#f0d0b8')
  return c
}

/** Fallback preview used if core.layoutSheet isn't available — mirrors the layout flags closely enough for staff to judge. */
function drawFallback(c: HTMLCanvasElement, l: PrintLayout) {
  const g = c.getContext('2d')!, W = c.width, H = c.height, u = W / 20
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  const footerH = u * 3.2, pad = u * 0.8, n = l.photosPerSheet
  const area = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 - footerH }
  const cols = n === 4 ? 2 : 1, rows = Math.ceil(n / cols), gap = u * 0.5
  const cw = (area.w - gap * (cols - 1)) / cols, ch = (area.h - gap * (rows - 1)) / rows
  for (let i = 0; i < n; i++) {
    const x = area.x + (i % cols) * (cw + gap), y = area.y + Math.floor(i / cols) * (ch + gap)
    g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip()
    const s = sampleShot(i), k = Math.max(cw / s.width, ch / s.height); g.drawImage(s, x + (cw - s.width * k) / 2, y + (ch - s.height * k) / 2, s.width * k, s.height * k); g.restore()
  }
  g.fillStyle = '#181818'; g.textBaseline = 'middle'
  const fy = H - footerH / 2 - pad / 2
  if (l.showLogo) { g.font = `800 ${u * 1.1}px sans-serif`; g.textAlign = 'left'; g.fillText('imagine', pad, fy); const w = g.measureText('imagine').width; g.fillStyle = '#B80021'; g.beginPath(); g.arc(pad + w + u * 0.35, fy + u * 0.35, u * 0.22, 0, 7); g.fill() }
  g.fillStyle = '#181818'
  if (l.footerText) { g.font = `600 ${u * 0.7}px sans-serif`; g.textAlign = l.showLogo ? 'center' : 'left'; g.fillText(l.footerText, l.showLogo ? W / 2 : pad, fy) }
  if (l.qrCode) {
    let m: boolean[][]; try { m = qrMatrix('https://example.com/p/abc') } catch { m = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => ((x * 7 + y * 13 + x * y) % 3) === 0)) }
    const q = footerH * 0.85, cell = q / m.length, ox = W - pad - q, oy = H - pad / 2 - footerH / 2 - q / 2
    m.forEach((r, y) => r.forEach((v, x) => { if (v) g.fillRect(ox + x * cell, oy + y * cell, cell + 0.3, cell + 0.3) }))
  }
}

export function SheetPreview({ layout }: { layout: PrintLayout }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState<'core' | 'fallback'>('core')
  const [w, h] = SIZE_PX[layout.size] ?? [1200, 1800]
  useEffect(() => {
    const c = ref.current!; c.width = 360; c.height = Math.round(360 * h / w)
    try {
      const shots = Array.from({ length: layout.photosPerSheet }, (_, i) => toRGBA(sampleShot(i), 600))
      const out = sheet(layout, shots)
      const oc = rgbaToCanvas(out), g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(oc, 0, 0, c.width, c.height); setSrc('core')
    } catch { drawFallback(c, layout); setSrc('fallback') }
  }, [layout, w, h])
  return (
    <div>
      <canvas ref={ref} role="img" aria-label={`live preview of ${layout.name}`} style={{ width: 360, borderRadius: 12, boxShadow: '0 6px 24px #000a', background: '#fff', display: 'block' }} />
      <p className="ad-muted" style={{ fontSize: 12 }}>{w}x{h}px · {layout.photosPerSheet}-up {src === 'fallback' && '· approximate preview'}</p>
    </div>
  )
}

export default function Layouts() {
  const layouts = useLoad(() => window.booth.library.layouts())
  const settings = useLoad(() => window.booth.settings.get())
  const [sel, setSel] = useState<string>()
  const [ov, setOv] = useState<Record<string, PrintLayout>>({})
  const [toast, toastNode] = useToast()
  useEffect(() => { if (!sel && layouts.data?.length) setSel(settings.data?.defaultLayoutId ?? layouts.data[0].id) }, [layouts.data, settings.data])
  const base = layouts.data?.find(l => l.id === sel)
  const layout = base ? ov[base.id] ?? base : undefined
  const edit = (p: Partial<PrintLayout>) => { if (layout) setOv({ ...ov, [layout.id]: { ...layout, ...p } }) }
  const dirty = !!layout && !!base && JSON.stringify(layout) !== JSON.stringify(base)
  const save = async () => {
    if (!layout) return
    try { await window.booth.library.saveLayout(layout); layouts.reload(); setOv(({ [layout.id]: _, ...rest }) => rest); toast('layout saved') } catch (e) { toast('could not save layout: ' + (e as Error).message) }
  }
  const setDefault = async () => { if (!layout) return; await window.booth.settings.set({ defaultLayoutId: layout.id }); settings.reload(); toast(`default layout: ${layout.name}`) }
  const setCopies = async (n: number) => { await window.booth.settings.set({ maxPrintsPerSession: n }); settings.reload() }

  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '280px 1fr 420px', alignItems: 'start' }}>
      <div className="ad-card">
        <h3>layouts</h3>
        <div className="ad-grid" style={{ gap: 10 }}>
          {(layouts.data ?? []).map(l => (
            <button key={l.id} className="ad-tile" aria-pressed={sel === l.id} onClick={() => setSel(l.id)}>
              {l.name}<br /><span className="ad-muted" style={{ fontSize: 12 }}>{l.size} · {l.photosPerSheet}-up</span>
              {settings.data?.defaultLayoutId === l.id && <> <Chip tone="ok">default</Chip></>}
            </button>
          ))}
        </div>
      </div>
      <div className="ad-card">
        {layout ? (
          <>
            <div className="ad-row sp"><h3 style={{ margin: 0 }}>{layout.name}</h3>{dirty && <Chip tone="warn">unsaved</Chip>}</div>
            <p className="ad-muted">{layout.size} paper · {layout.photosPerSheet} photo{layout.photosPerSheet > 1 ? 's' : ''} per sheet</p>
            <div className="ad-grid" style={{ gap: 6 }}>
              <Toggle checked={layout.showLogo} onChange={v => edit({ showLogo: v })} label="show imagine logo" />
              <Toggle checked={layout.qrCode} onChange={v => edit({ qrCode: v })} label="qr code for digital download" />
              <Field label="footer text"><input type="text" value={layout.footerText ?? ''} placeholder="e.g. franklin institute · 2026" onChange={e => edit({ footerText: e.target.value })} /></Field>
              <Field label="copies per session"><input type="number" min={1} max={20} value={settings.data?.maxPrintsPerSession ?? 2} onChange={e => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></Field>
            </div>
            <div className="ad-row" style={{ marginTop: 16 }}>
              <button className="ad-btn" onClick={save} disabled={!dirty}>save layout</button>
              <button className="ad-btn ghost" onClick={setDefault} disabled={settings.data?.defaultLayoutId === layout.id}>make default</button>
            </div>
          </>
        ) : <p className="ad-muted">pick a layout.</p>}
      </div>
      <div className="ad-card" style={{ display: 'grid', placeItems: 'center' }}>{layout && <SheetPreview layout={layout} />}</div>
      {toastNode}
    </div>
  )
}
