import React, { useState } from 'react'
import { Chip, Field, Seg, useLoad, useToast } from '../ui'
import { SIZE_PX } from '../helpers'
import { testSheet } from '../imgutil'
import { markTestSession } from '../coreAdapter'
import type { PrintSize } from '../../../shared/types'

const SIZES = ['4x6', '2x6-strip', '5x7', '6x8'] as const

export default function Hardware() {
  const settings = useLoad(() => window.booth.settings.get())
  const cams = useLoad(() => window.booth.camera.list())
  const prs = useLoad(() => window.booth.printer.list())
  const [toast, toastNode] = useToast()
  const [busy, setBusy] = useState<string>()
  const [cap, setCap] = useState<{ ms: number; url?: string; err?: string }>()
  const [size, setSize] = useState<PrintSize>('4x6')
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string }>()
  const s = settings.data

  const setDefault = async (p: { cameraId?: string; printerName?: string }) => { await window.booth.settings.set(p); settings.reload(); toast('saved') }
  const connect = async (id: string) => {
    setBusy('connect:' + id)
    try { await window.booth.camera.connect(id); await setDefault({ cameraId: id }); toast('camera connected') } catch (e) { toast('connect failed: ' + (e as Error).message) } finally { setBusy(undefined) }
  }
  const testCapture = async () => {
    setBusy('capture'); setCap(undefined)
    const t0 = performance.now()
    try { const url = await window.booth.camera.capture(); setCap({ ms: Math.round(performance.now() - t0), url }) }
    catch (e) { setCap({ ms: Math.round(performance.now() - t0), err: (e as Error).message }) }
    finally { setBusy(undefined) }
  }
  const testPrint = async () => {
    setBusy('print'); setPrintMsg(undefined)
    const [w, h] = SIZE_PX[size]
    try {
      const sheet = testSheet(w, h, `${size} · ${new Date().toLocaleString()} · ${s?.printerName ?? 'default printer'}`).toDataURL('image/jpeg', 0.95)
      const se = await window.booth.session.start()
      await markTestSession(se.id)
      await window.booth.session.saveComposite(se.id, sheet)
      const r = await window.booth.printer.print(se.id, 1)
      setPrintMsg({ ok: true, text: `sent to printer (job ${r.jobId}). check the paper: size ${w}x${h}px, nothing cropped, colors match the swatches.` })
    } catch (e) { setPrintMsg({ ok: false, text: 'print failed: ' + (e as Error).message }) } finally { setBusy(undefined); prs.reload() }
  }
  const tone = (st: string) => st === 'ready' ? 'ok' : st === 'busy' ? 'warn' : st === 'offline' ? 'bad' : 'idle'
  const capTone = !cap ? 'idle' : cap.err ? 'bad' : cap.ms < 3000 ? 'ok' : 'warn'

  return (
    <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
      <div className="ad-card">
        <div className="ad-row sp"><h3 style={{ margin: 0 }}>cameras</h3><button className="ad-btn sm ghost" onClick={cams.reload}>rescan</button></div>
        {cams.error && <p className="ad-bad">{cams.error}</p>}
        {!cams.loading && !cams.data?.length && <p className="ad-muted">no cameras found. check the usb cable (data, not charge-only) and that the camera is on and not in sleep mode.</p>}
        <table aria-label="cameras"><tbody>
          {(cams.data ?? []).map(c => (
            <tr key={c.id}>
              <td><b>{c.label}</b><br /><span className="ad-muted" style={{ fontSize: 12 }}>{c.kind}</span></td>
              <td>{s?.cameraId === c.id ? <Chip tone="ok">default</Chip> : null}</td>
              <td style={{ textAlign: 'right' }}><button className="ad-btn sm" disabled={!!busy} onClick={() => connect(c.id)}>{busy === 'connect:' + c.id ? 'connecting…' : s?.cameraId === c.id ? 'reconnect' : 'connect + use'}</button></td>
            </tr>
          ))}
        </tbody></table>
        <h4>test capture</h4>
        <div className="ad-row">
          <button className="ad-btn" onClick={testCapture} disabled={!!busy}>{busy === 'capture' ? 'shooting…' : 'test capture'}</button>
          {cap && <Chip tone={capTone}>{cap.err ? 'failed' : `${cap.ms} ms`}{!cap.err && ' · target < 3000 ms'}</Chip>}
        </div>
        {cap?.err && <p className="ad-bad" role="alert">{cap.err}</p>}
        {cap?.url && <img src={cap.url} alt="test capture" style={{ marginTop: 12, width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 18, background: '#000' }} />}
      </div>

      <div className="ad-card">
        <div className="ad-row sp"><h3 style={{ margin: 0 }}>printers</h3><button className="ad-btn sm ghost" onClick={prs.reload}>rescan</button></div>
        {prs.error && <p className="ad-bad">{prs.error}</p>}
        {!prs.loading && !prs.data?.length && <p className="ad-muted">no printers found. install the vendor driver and print the vendor test page first.</p>}
        <table aria-label="printers"><tbody>
          {(prs.data ?? []).map(p => (
            <tr key={p.name}>
              <td><b>{p.displayName}</b>{p.isDefault && <span className="ad-muted"> · system default</span>}</td>
              <td><Chip tone={tone(p.status)}>{p.status}</Chip></td>
              <td style={{ textAlign: 'right' }}>{s?.printerName === p.name ? <Chip tone="ok">booth printer</Chip> : <button className="ad-btn sm ghost" onClick={() => setDefault({ printerName: p.name })}>use for booth</button>}</td>
            </tr>
          ))}
        </tbody></table>
        <h4>test print</h4>
        <div className="ad-row" style={{ marginBottom: 10 }}><Seg<PrintSize> label="paper size" value={size} options={SIZES} onChange={setSize} /></div>
        <div className="ad-row">
          <button className="ad-btn" onClick={testPrint} disabled={!!busy}>{busy === 'print' ? 'sending…' : 'test print'}</button>
          <span className="ad-muted">color + alignment sheet · {SIZE_PX[size].join('x')}px</span>
        </div>
        {printMsg && <p className={printMsg.ok ? 'ad-ok' : 'ad-bad'} role="status">{printMsg.text}</p>}
      </div>

      <div className="ad-card" style={{ gridColumn: 'span 2' }}>
        <h3>troubleshooting</h3>
        <div className="ad-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0 28px' }}>
          <div>
            <details open><summary>camera not listed</summary><ul className="ad-tips"><li>use a data usb cable, plug straight into the pc (no hub), power the camera on.</li><li>mac/linux need <code>gphoto2</code>; windows needs digiCamControl running. close other apps that grab the camera (photos, canon eos utility).</li><li>after a replug press rescan, then connect.</li></ul></details>
            <details><summary>capture is slow (&gt; 3 s)</summary><ul className="ad-tips"><li>set camera to jpeg (not raw+jpeg), small/medium size, manual focus.</li><li>use usb 3 and an ac dummy battery so the camera never sleeps.</li></ul></details>
          </div>
          <div>
            <details open><summary>printer offline or nothing prints</summary><ul className="ad-tips"><li>print the vendor test page from the os first; if that fails it is the driver, not the booth.</li><li>check paper/ribbon match (4x6 media for 4x6 sheet) and clear the queue of stuck jobs.</li></ul></details>
            <details><summary>test print is cropped or has borders</summary><ul className="ad-tips"><li>in the printer driver set paper to the exact size and turn off "fit to page" and borders.</li><li>the black frame on the sheet should be fully visible on all four edges.</li></ul></details>
          </div>
        </div>
      </div>
      {toastNode}
    </div>
  )
}
