import React, { useEffect, useState } from 'react'
import { Chip, Field, Slider, useLoad, useToast } from '../ui'
import { exportSettingsJson, mergeImportedShare, validateSettingsImport } from '../helpers'
import { download } from '../imgutil'
import type { VenueSettings } from '../../../shared/types'

const SWATCHES = ['#B80021', '#e0153b', '#d35400', '#0a7d5a', '#1f5fbf', '#6a3fb5']
const HEX = /^#[0-9a-fA-F]{6}$/

export default function Settings() {
  const st = useLoad(() => window.booth.settings.get())
  const [d, setD] = useState<VenueSettings>()
  const [toast, toastNode] = useToast()
  const [pin, setPin] = useState({ cur: '', next: '', again: '' })
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; t: string }>()
  const [imp, setImp] = useState<{ errors: string[]; settings?: Partial<VenueSettings>; name: string }>()
  useEffect(() => { if (st.data) setD(structuredClone(st.data)) }, [st.data])
  if (!d || !st.data) return <p className="ad-muted">loading…</p>
  const dirty = JSON.stringify(d) !== JSON.stringify(st.data)
  const up = (p: Partial<VenueSettings>) => setD({ ...d, ...p })
  const save = async () => {
    if (!HEX.test(d.brand.accent)) { toast('accent must look like #B80021'); return }
    const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo))
    await window.booth.settings.set({ ...d, idleTimeoutSec: cl(d.idleTimeoutSec, 10, 600), countdownSec: cl(d.countdownSec, 1, 10), maxPrintsPerSession: cl(d.maxPrintsPerSession, 1, 20), adminPin: st.data!.adminPin, share: st.data!.share }); st.reload(); toast('settings saved')
  }
  const changePin = async () => {
    if (pin.cur !== st.data!.adminPin) return setPinMsg({ ok: false, t: 'current pin is wrong' })
    if (!/^\d{4,8}$/.test(pin.next)) return setPinMsg({ ok: false, t: 'new pin must be 4 to 8 digits' })
    if (pin.next !== pin.again) return setPinMsg({ ok: false, t: 'new pins do not match' })
    await window.booth.settings.set({ adminPin: pin.next }); st.reload(); setPin({ cur: '', next: '', again: '' }); setPinMsg({ ok: true, t: 'pin changed' })
  }
  const onFile = async (f: File) => {
    try { const r = validateSettingsImport(JSON.parse(await f.text())); setImp({ errors: r.errors, settings: r.settings, name: f.name }) }
    catch { setImp({ errors: ['that file is not valid json'], name: f.name }) }
  }
  const applyImport = async () => { if (!imp?.settings) return; const { share, ...rest } = imp.settings; await window.booth.settings.set(share ? { ...rest, share: mergeImportedShare(st.data!.share, share) } : rest); st.reload(); setImp(undefined); toast('settings imported') }
  const num = (k: 'idleTimeoutSec' | 'countdownSec' | 'maxPrintsPerSession') => ({
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => up({ [k]: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) } as any),
    onBlur: (lo: number, hi: number) => up({ [k]: Math.max(lo, Math.min(hi, Math.round(Number(d[k])) || lo)) } as any)
  })
  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
      <div className="ad-card">
        <div className="ad-row sp"><h3 style={{ margin: 0 }}>venue</h3>{dirty && <Chip tone="warn">unsaved</Chip>}</div>
        <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
          <Field label="venue name"><input type="text" value={d.venueName} onChange={e => up({ venueName: e.target.value })} /></Field>
          <Field label="welcome text"><input type="text" value={d.welcomeText} onChange={e => up({ welcomeText: e.target.value })} /></Field>
          <Field label="idle timeout (seconds, 10–600)"><input type="number" value={d.idleTimeoutSec} min={10} max={600} onChange={num('idleTimeoutSec').onChange} onBlur={() => num('idleTimeoutSec').onBlur(10, 600)} /></Field>
          <Field label="countdown (seconds, 1–10)"><input type="number" value={d.countdownSec} min={1} max={10} onChange={num('countdownSec').onChange} onBlur={() => num('countdownSec').onBlur(1, 10)} /></Field>
          <Field label="max prints per session (1–20)"><input type="number" value={d.maxPrintsPerSession} min={1} max={20} onChange={num('maxPrintsPerSession').onChange} onBlur={() => num('maxPrintsPerSession').onBlur(1, 20)} /></Field>
        </div>
        <h4>accent color</h4>
        <div className="ad-row">
          {SWATCHES.map(c => <button key={c} aria-label={`accent ${c}`} aria-pressed={d.brand.accent.toLowerCase() === c.toLowerCase()} onClick={() => up({ brand: { ...d.brand, accent: c } })} style={{ width: 44, height: 44, borderRadius: '50%', background: c, border: d.brand.accent.toLowerCase() === c.toLowerCase() ? '4px solid #fff' : '4px solid transparent', cursor: 'pointer' }} />)}
          <input aria-label="custom accent" type="color" value={HEX.test(d.brand.accent) ? d.brand.accent : '#B80021'} onChange={e => up({ brand: { ...d.brand, accent: e.target.value } })} style={{ width: 52, height: 44, border: 0, background: 'none' }} />
          <span className="ad-muted">{d.brand.accent}</span>
        </div>
        <div className="ad-row" style={{ marginTop: 22 }}>
          <button className="ad-btn" onClick={save} disabled={!dirty}>save settings</button>
          <button className="ad-btn ghost" onClick={() => setD(structuredClone(st.data!))} disabled={!dirty}>revert</button>
        </div>
      </div>

      <div className="ad-grid">
        <div className="ad-card">
          <h3>admin pin</h3>
          <div className="ad-grid" style={{ gap: 10 }}>
            <Field label="current pin"><input type="password" inputMode="numeric" autoComplete="off" value={pin.cur} onChange={e => setPin({ ...pin, cur: e.target.value })} /></Field>
            <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="new pin (4–8 digits)"><input type="password" inputMode="numeric" autoComplete="off" value={pin.next} onChange={e => setPin({ ...pin, next: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="repeat new pin"><input type="password" inputMode="numeric" autoComplete="off" value={pin.again} onChange={e => setPin({ ...pin, again: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
            <div className="ad-row"><button className="ad-btn" onClick={changePin} disabled={!pin.cur || !pin.next}>change pin</button>{pinMsg && <span className={pinMsg.ok ? 'ad-ok' : 'ad-bad'} role="status">{pinMsg.t}</span>}</div>
          </div>
        </div>
        <div className="ad-card">
          <h3>backup</h3>
          <p className="ad-muted">move a venue's setup to another booth. the export includes the admin pin, so keep the file private. the sharing booth key is never exported or imported; enter it again on the sharing tab.</p>
          <div className="ad-row">
            <button className="ad-btn ghost" onClick={() => download(`imagine-booth-settings-${new Date().toISOString().slice(0, 10)}.json`, exportSettingsJson(st.data!))}>export settings</button>
            <label className="ad-btn ghost" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>import settings
              <input type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
            </label>
          </div>
          {imp && (
            <div style={{ marginTop: 14 }} role="status">
              {imp.errors.length ? <><p className="ad-bad"><b>{imp.name}</b> can't be imported:</p><ul className="ad-tips">{imp.errors.map(e => <li key={e}>{e}</li>)}</ul></>
                : <><p className="ad-ok"><b>{imp.name}</b> looks good — {Object.keys(imp.settings!).length} settings will be replaced.</p><div className="ad-row"><button className="ad-btn sm" onClick={applyImport}>apply</button><button className="ad-btn sm ghost" onClick={() => setImp(undefined)}>cancel</button></div></>}
            </div>
          )}
        </div>
      </div>
      {toastNode}
    </div>
  )
}
