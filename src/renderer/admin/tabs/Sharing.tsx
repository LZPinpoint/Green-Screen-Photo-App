import React, { useEffect, useState } from 'react'
import { Chip, Field, Toggle, useLoad, useToast } from '../ui'
import { draftToShare, healthMessage, normalizeBaseUrl, shareStatusView, shareToDraft, validateShare } from '../helpers'
import type { HealthResult, ShareDraft } from '../helpers'

type Status = { pending: number; failed: number; total: number }

export async function pingHealth(baseUrl: string, doFetch: typeof fetch = fetch): Promise<HealthResult> {
  const t0 = Date.now()
  try {
    const r = await doFetch(normalizeBaseUrl(baseUrl) + '/healthz', { cache: 'no-store' })
    return r.ok ? { ok: true, ms: Date.now() - t0 } : { ok: false, kind: 'http', status: r.status }
  } catch { return { ok: false, kind: 'network' } }
}

export default function Sharing() {
  const st = useLoad(() => window.booth.settings.get())
  const [d, setD] = useState<ShareDraft>()
  const [reveal, setReveal] = useState(false)
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<Status>()
  const [test, setTest] = useState<{ busy: boolean; res?: ReturnType<typeof healthMessage> }>({ busy: false })
  const [toast, toastNode] = useToast()
  useEffect(() => { if (st.data) setD(shareToDraft(st.data.share)) }, [st.data])
  useEffect(() => {
    let live = true
    const poll = () => window.booth.share.status().then(s => live && setStatus(s)).catch(() => {})
    poll(); const t = setInterval(poll, 5000)
    return () => { live = false; clearInterval(t) }
  }, [])
  if (!d || !st.data) return <p className="ad-muted">loading…</p>
  const v = validateShare(d)
  const saved = shareToDraft(st.data.share)
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)
  const up = (p: Partial<ShareDraft>) => { setD({ ...d, ...p }); setTouched(true) }
  const err = (k: keyof typeof v.errors) => touched && v.errors[k] ? <span className="ad-bad" role="alert" style={{ fontSize: 13 }}>{v.errors[k]}</span> : null
  const save = async () => {
    setTouched(true)
    if (!v.ok) { toast('fix the highlighted fields first'); return }
    try { await window.booth.settings.set({ share: draftToShare(d) }); st.reload(); toast(d.enabled ? 'sharing saved and on' : 'sharing saved (off)') } catch (e) { toast('could not save: ' + (e as Error).message) }
  }
  const runTest = async () => {
    if (v.errors.baseUrl || !d.baseUrl.trim()) { setTouched(true); setTest({ busy: false, res: { tone: 'bad', text: 'enter a valid server address first.' } }); return }
    setTest({ busy: true }); const r = await pingHealth(d.baseUrl); setTest({ busy: false, res: healthMessage(r) })
  }
  const sv = shareStatusView(status, st.data.share?.enabled)
  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
      <div className="ad-card">
        <div className="ad-row sp"><h3 style={{ margin: 0 }}>digital sharing</h3>{dirty && <Chip tone="warn">unsaved</Chip>}</div>
        <div style={{ marginTop: 12 }}><Toggle checked={d.enabled} onChange={v2 => up({ enabled: v2 })} label="send guests their photos digitally" /></div>
        <div className="ad-grid" style={{ gap: 12, marginTop: 12 }}>
          <Field label="server address"><input type="text" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://photos.example.com" value={d.baseUrl} onChange={e => up({ baseUrl: e.target.value })} aria-invalid={touched && !!v.errors.baseUrl} /></Field>{err('baseUrl')}
          <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="venue id"><input type="text" autoComplete="off" value={d.venueId} onChange={e => up({ venueId: e.target.value })} aria-invalid={touched && !!v.errors.venueId} /></Field>
            <Field label="keep photos for (days)"><input type="number" min={1} max={3650} value={d.retentionDays} onChange={e => up({ retentionDays: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
          </div>
          {err('venueId')}{err('retentionDays')}
          <Field label="booth key">
            <span className="ad-row" style={{ flexWrap: 'nowrap' }}>
              <input type={reveal ? 'text' : 'password'} autoComplete="off" spellCheck={false} style={{ flex: 1 }} value={d.apiKey} onChange={e => up({ apiKey: e.target.value })} aria-invalid={touched && !!v.errors.apiKey} />
              <button type="button" className="ad-btn sm ghost" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>{reveal ? 'hide' : 'show'}</button>
            </span>
          </Field>{err('apiKey')}
        </div>
        <div className="ad-row" style={{ marginTop: 20 }}>
          <button className="ad-btn" onClick={save} disabled={!dirty}>save sharing</button>
          <button className="ad-btn ghost" onClick={() => { setD(shareToDraft(st.data!.share)); setTouched(false) }} disabled={!dirty}>revert</button>
          <button className="ad-btn ghost" onClick={runTest} disabled={test.busy}>{test.busy ? 'testing…' : 'test connection'}</button>
        </div>
        {test.res && <p className={test.res.tone === 'ok' ? 'ad-ok' : 'ad-bad'} role="status" style={{ fontSize: 14 }}>{test.res.text}</p>}
        {!test.res && <p className="ad-muted" style={{ fontSize: 12 }}>the connection test runs from the booth. if it fails but uploads work, ignore it.</p>}
      </div>

      <div className="ad-grid">
        <div className="ad-card">
          <div className="ad-row sp"><h3 style={{ margin: 0 }}>upload status</h3><Chip tone={sv.tone}>{sv.text}</Chip></div>
          <p className="ad-muted" style={{ fontSize: 13 }}>photos upload in the background after each session, so guests never wait. waiting uploads retry on their own; if the count stays above zero, check the booth's internet and the key.</p>
        </div>
        <div className="ad-card">
          <h3>what guests get</h3>
          <ul className="ad-tips">
            <li>a qr code printed on their sheet that opens their photos on a phone</li>
            <li>a phone gallery page with their photos to save or share</li>
            <li>optionally, a gallery link by email, only if they agree on the kiosk</li>
          </ul>
          <p className="ad-muted" style={{ fontSize: 13 }}>photos are deleted from the server after the retention period. with sharing off, the booth works fully offline and nothing is uploaded.</p>
        </div>
        <div className="ad-card">
          <h3>setting up the server</h3>
          <p className="ad-muted" style={{ fontSize: 13, margin: 0 }}>the free cloudflare server and the venue key are set up once, following <code style={{ textTransform: "none" }}>cloud/README.md</code> in the project folder. it ends with a server address, a venue id and a booth key to paste here.</p>
        </div>
      </div>
      {toastNode}
    </div>
  )
}
