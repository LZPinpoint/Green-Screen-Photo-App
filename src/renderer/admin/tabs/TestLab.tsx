import React, { useEffect, useState } from 'react'
import { Chip, libImage, useToast } from '../ui'
import { CHECKLIST, buildReportJson, buildReportMarkdown, checklistProgress, SIZE_PX } from '../helpers'
import type { CheckState, StageTiming } from '../helpers'
import { chromaKey, compose, markTestSession, sheet } from '../coreAdapter'
import type { RGBAImage } from '../coreAdapter'
import { download, loadImg, makeCanvas, rgbaToDataUrl, sampleCanvas, toRGBA } from '../imgutil'

const LS_C = 'imagine.admin.checks', LS_N = 'imagine.admin.notes', LS_S = 'imagine.admin.selftest'
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || '') as T } catch { return d } }
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

async function timed<T>(stage: string, out: StageTiming[], fn: () => Promise<T> | T, note?: (v: T) => string): Promise<T | undefined> {
  const t0 = performance.now()
  try { const v = await fn(); out.push({ stage, ms: performance.now() - t0, ok: true, note: note?.(v) }); return v }
  catch (e) { out.push({ stage, ms: performance.now() - t0, ok: false, note: (e as Error).message }); return undefined }
}

export async function runSelfTest(onStage?: (t: StageTiming[]) => void): Promise<StageTiming[]> {
  const out: StageTiming[] = []
  const push = () => onStage?.([...out])
  const s = await window.booth.settings.get()
  let frameUrl: string | undefined
  frameUrl = await timed('capture', out, () => window.booth.camera.capture(), () => 'camera frame'); push()
  if (!frameUrl) { out[out.length - 1].note += ' · using synthetic frame for the remaining stages'; frameUrl = sampleCanvas(1280, 720).toDataURL('image/jpeg') }
  const frame = await timed('decode', out, async () => toRGBA(await loadImg(frameUrl!), 960), f => `${f.width}x${f.height}`); push()
  const keyed = frame && await timed('key', out, () => chromaKey(frame, s.key), () => `mode ${s.key.mode}`); push()
  const scenes = await window.booth.library.scenes().catch(() => [])
  const scene = scenes.find(x => x.enabled) ?? scenes[0]
  const [w, h] = SIZE_PX['4x6']
  const comp = keyed && await timed('compose', out, async () => {
    let bg: RGBAImage
    if (scene) bg = toRGBA(await loadImg(await libImage(scene.file)), w)
    else { const c = makeCanvas(w, h); const g = c.getContext('2d')!; g.fillStyle = '#333'; g.fillRect(0, 0, w, h); bg = toRGBA(c, w) }
    return compose(keyed, bg, scene?.anchor ?? { x: 0.5, y: 0.97, scale: 0.8 }, w, h)
  }, c => `${c.width}x${c.height}${scene ? ' · ' + scene.name : ''}`); push()
  const layouts = await window.booth.library.layouts().catch(() => [])
  const layout = layouts.find(l => l.id === s.defaultLayoutId) ?? layouts[0]
  const sheetImg = comp && layout && await timed('layout', out, () => sheet(layout, Array.from({ length: layout.photosPerSheet }, () => comp)), r => `${layout.name} → ${r.width}x${r.height}`)
  if (comp && !layout) out.push({ stage: 'layout', ms: 0, ok: false, note: 'no layouts available' })
  push()
  const finalImg = sheetImg || undefined
  if (finalImg) {
    await timed('virtual print', out, async () => {
      const se = await window.booth.session.start()
      await markTestSession(se.id)
      await window.booth.session.saveComposite(se.id, rgbaToDataUrl(finalImg))
      const r = await window.booth.printer.print(se.id, 1)
      return r.jobId
    }, id => `job ${id} (check printer is the virtual pdf one)`)
  } else out.push({ stage: 'virtual print', ms: 0, ok: false, note: 'skipped — earlier stage failed' })
  push()
  return out
}

export default function TestLab() {
  const [checks, setChecks] = useState<Record<string, CheckState>>(() => load(LS_C, {}))
  const [notes, setNotes] = useState<Record<string, string>>(() => load(LS_N, {}))
  const [self, setSelf] = useState<StageTiming[]>(() => load(LS_S, []))
  const [running, setRunning] = useState(false)
  const [venue, setVenue] = useState('')
  const [toast, toastNode] = useToast()
  useEffect(() => { window.booth.settings.get().then(s => setVenue(s.venueName)).catch(() => {}) }, [])
  useEffect(() => store(LS_C, checks), [checks])
  useEffect(() => store(LS_N, notes), [notes])

  const p = checklistProgress(checks)
  const set = (id: string, v: CheckState) => setChecks(c => ({ ...c, [id]: c[id] === v ? 'unset' : v }))
  const input = () => ({ venue: venue || 'unknown venue', when: new Date(), checks, notes, selfTest: self })
  const run = async () => { setRunning(true); setSelf([]); try { const r = await runSelfTest(setSelf); setSelf(r); store(LS_S, r) } catch (e) { toast('self-test crashed: ' + (e as Error).message) } finally { setRunning(false) } }
  const stamp = new Date().toISOString().slice(0, 10)
  const groups = Array.from(new Set(CHECKLIST.map(c => c.group)))
  const total = self.reduce((a, s) => a + s.ms, 0)

  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
      <div className="ad-card">
        <div className="ad-row sp">
          <h3 style={{ margin: 0 }}>test checklist</h3>
          <div className="ad-row"><Chip tone="ok">{p.pass} pass</Chip><Chip tone={p.fail ? 'bad' : 'idle'}>{p.fail} fail</Chip><Chip>{p.open} open</Chip></div>
        </div>
        <div className="ad-bar" style={{ margin: '12px 0' }} role="progressbar" aria-valuenow={p.pass} aria-valuemin={0} aria-valuemax={p.total} aria-label="checklist progress"><i style={{ width: `${(p.pass / p.total) * 100}%` }} /></div>
        {groups.map(g => (
          <section key={g} aria-label={g}>
            <h4>{g}</h4>
            {CHECKLIST.filter(c => c.group === g).map(c => (
              <div key={c.id} className="ad-check">
                <div>
                  <div>{c.text}</div>
                  {c.hint && <div className="ad-muted" style={{ fontSize: 12 }}>{c.hint}</div>}
                  {checks[c.id] === 'fail' && <input className="ad-input" style={{ marginTop: 6, minHeight: 36 }} placeholder="what went wrong?" aria-label={`note for ${c.text}`} value={notes[c.id] ?? ''} onChange={e => setNotes({ ...notes, [c.id]: e.target.value })} />}
                </div>
                <div className="ad-seg" role="group" aria-label={c.text}>
                  <button aria-pressed={checks[c.id] === 'pass'} onClick={() => set(c.id, 'pass')}>pass</button>
                  <button aria-pressed={checks[c.id] === 'fail'} onClick={() => set(c.id, 'fail')} style={checks[c.id] === 'fail' ? { background: '#5a1420' } : undefined}>fail</button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="ad-grid">
        <div className="ad-card">
          <h3>automated self-test</h3>
          <p className="ad-muted">capture → key → compose → layout → virtual print, timed per stage. uses the current camera, key settings and default layout.</p>
          <button className="ad-btn" onClick={run} disabled={running}>{running ? 'running…' : 'run automated self-test'}</button>
          {self.length > 0 && (
            <table style={{ marginTop: 12 }} aria-label="self-test results"><thead><tr><th>stage</th><th>time</th><th>result</th></tr></thead><tbody>
              {self.map(s => <tr key={s.stage}><td>{s.stage}</td><td>{Math.round(s.ms)} ms</td><td className={s.ok ? 'ad-ok' : 'ad-bad'}>{s.ok ? 'ok' : 'fail'}{s.note && <div className="ad-muted" style={{ fontSize: 12 }}>{s.note}</div>}</td></tr>)}
              <tr><td><b>total</b></td><td colSpan={2}><b>{Math.round(total)} ms</b></td></tr>
            </tbody></table>
          )}
        </div>
        <div className="ad-card">
          <h3>report</h3>
          <p className="ad-muted">saves the checklist, notes and last self-test.</p>
          <div className="ad-row">
            <button className="ad-btn" onClick={() => download(`imagine-booth-report-${stamp}.md`, buildReportMarkdown(input()), 'text/markdown')}>download report (.md)</button>
            <button className="ad-btn ghost" onClick={() => download(`imagine-booth-report-${stamp}.json`, JSON.stringify(buildReportJson(input()), null, 2))}>json</button>
            <button className="ad-btn ghost sm" onClick={() => { setChecks({}); setNotes({}); toast('checklist cleared') }}>clear checklist</button>
          </div>
        </div>
      </div>
      {toastNode}
    </div>
  )
}
