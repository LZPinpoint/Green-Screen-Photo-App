import React, { useEffect, useState } from 'react'
import { Chip, Field, Slider, useLoad, useToast } from '../ui'
import { captureKeyLabel, exportSettingsJson, mergeImportedShare, normalizeTicketPrefix, staffToDraft, validateSettingsImport, validateStaffDraft, type StaffDraft } from '../helpers'
import { download } from '../imgutil'
import type { VenueSettings } from '../../../shared/types'

/** like Field, but a div (it holds buttons) and with an inline error */
function SField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <div className="ad-field" role="group" aria-label={label}>{label}{children}{error && <span className="ad-bad" role="alert">{error}</span>}</div>
}

const SWATCHES = ['#B80021', '#e0153b', '#d35400', '#0a7d5a', '#1f5fbf', '#6a3fb5']
const HEX = /^#[0-9a-fA-F]{6}$/

export default function Settings() {
  const st = useLoad(() => window.booth.settings.get())
  const [d, setD] = useState<VenueSettings>()
  const [toast, toastNode] = useToast()
  const [pin, setPin] = useState({ cur: '', next: '', again: '' })
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; t: string }>()
  const [sd, setSd] = useState<StaffDraft>()
  const [picking, setPicking] = useState(false)
  const [imp, setImp] = useState<{ errors: string[]; settings?: Partial<VenueSettings>; name: string }>()
  useEffect(() => { if (st.data) { setD(structuredClone(st.data)); setSd(staffToDraft(st.data)) } }, [st.data])
  // 'press a key' picker: the next key press becomes the shutter key
  useEffect(() => {
    if (!picking) return
    const on = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setPicking(false); return }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      setSd(cur => cur && { ...cur, captureKey: e.key }); setPicking(false)
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [picking])
  if (!d || !st.data || !sd) return <p className="ad-muted">loading…</p>
  const staffV = validateStaffDraft(sd)
  const staffDirty = JSON.stringify(sd) !== JSON.stringify(staffToDraft(st.data))
  const saveStaff = async () => {
    if (!staffV.ok || !staffV.staff) { toast('fix the highlighted staff options first'); return }
    // defaultSceneId belongs to the console (it saves it when staff pick a scene): keep it
    await window.booth.settings.set({ mode: staffV.mode, staff: { ...staffV.staff, defaultSceneId: st.data!.staff?.defaultSceneId } }); st.reload(); toast('operating mode saved')
  }
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
        <div className="ad-card" aria-labelledby="opmode-h">
          <div className="ad-row sp"><h3 id="opmode-h" style={{ margin: 0 }}>operating mode</h3>{staffDirty && <Chip tone="warn">unsaved</Chip>}</div>
          <p className="ad-muted">how this booth is run. takes effect when the screen next reloads (or after you leave admin).</p>
          <div className="ad-row" role="radiogroup" aria-label="operating mode" style={{ marginTop: 10 }}>
            {([['staff', 'staff mode', 'an attendant captures each group'], ['kiosk', 'self-serve booth', 'guests do it themselves']] as const).map(([m, t, sub]) => (
              <button key={m} role="radio" aria-checked={sd.mode === m} className={`ad-btn${sd.mode === m ? '' : ' ghost'}`} onClick={() => setSd({ ...sd, mode: m })} style={{ textAlign: 'left' }}>
                <span style={{ display: 'block' }}>{t}</span><small style={{ display: 'block', fontWeight: 400 }}>{sub}</small>
              </button>
            ))}
          </div>
          <h4>staff options</h4>
          <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <SField label="print automatically after each capture">
              <label className="ad-row" style={{ minHeight: 44 }}><input type="checkbox" checked={sd.autoPrint} onChange={e => setSd({ ...sd, autoPrint: e.target.checked })} style={{ width: 24, height: 24 }} /> {sd.autoPrint ? 'on — fast line mode' : 'off — staff press print'}</label>
            </SField>
            <SField label="default copies (1–10)" error={staffV.errors.copies}>
              <input type="number" min={1} max={10} value={sd.copies} onChange={e => setSd({ ...sd, copies: e.target.value === '' ? '' : Number(e.target.value) })} aria-invalid={!!staffV.errors.copies} />
            </SField>
            <SField label="ticket prefix (e.g. A → A001)" error={staffV.errors.ticketPrefix}>
              <input type="text" value={sd.ticketPrefix} maxLength={3} onChange={e => setSd({ ...sd, ticketPrefix: normalizeTicketPrefix(e.target.value) })} aria-invalid={!!staffV.errors.ticketPrefix} />
            </SField>
            <SField label="countdown before the shot (0 = instant)" error={staffV.errors.countdownSec}>
              <input type="number" min={0} max={10} value={sd.countdownSec} onChange={e => setSd({ ...sd, countdownSec: e.target.value === '' ? '' : Number(e.target.value) })} aria-invalid={!!staffV.errors.countdownSec} />
            </SField>
            <SField label="capture key (works with presenter clickers)" error={staffV.errors.captureKey}>
              <div className="ad-row">
                <button className={`ad-btn${picking ? '' : ' ghost'}`} onClick={() => setPicking(p => !p)} aria-live="polite">{picking ? 'press a key… (esc cancels)' : `key: ${captureKeyLabel(sd.captureKey)} · change`}</button>
                {sd.captureKey !== ' ' && !picking && <button className="ad-btn ghost sm" onClick={() => setSd({ ...sd, captureKey: ' ' })}>reset to space</button>}
              </div>
            </SField>
          </div>
          <div className="ad-row" style={{ marginTop: 18 }}>
            <button className="ad-btn" onClick={saveStaff} disabled={!staffDirty || !staffV.ok}>save operating mode</button>
            <button className="ad-btn ghost" onClick={() => setSd(staffToDraft(st.data!))} disabled={!staffDirty}>revert</button>
          </div>
        </div>
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
