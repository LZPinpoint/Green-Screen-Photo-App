import { useEffect, useMemo, useRef, useState } from 'react'
import { qrMatrix } from '@core/index'
import OnScreenKeyboard from './OnScreenKeyboard'
import type { Cfg } from './types'

export type Reservation = { shareId: string; guestUrl: string }

const IDLE_SECONDS = 45
const SENT_SECONDS = 12
export const isEmail = (e: string) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(e.trim())

function QrTile({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    let m: boolean[][]
    try { m = qrMatrix(text) } catch { return }
    const quiet = 4, n = m.length + quiet * 2, scale = Math.max(4, Math.floor(720 / n))
    c.width = c.height = n * scale
    const x = c.getContext('2d')!
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
    x.fillStyle = '#181818'
    m.forEach((row, y) => row.forEach((d, i) => { if (d) x.fillRect((i + quiet) * scale, (y + quiet) * scale, scale, scale) }))
  }, [text])
  return <canvas ref={ref} className="share-qr" role="img" aria-label="qr code that opens your photo on your phone" />
}

/** after printing: scan a QR or get the link by email. Email lives only in this component's state and dies with it. */
export default function ShareScreen({ cfg, reservation, onDone }: {
  cfg: Cfg; reservation: Promise<Reservation | null>; onDone: () => void
}) {
  const [res, setRes] = useState<Reservation | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [left, setLeft] = useState(IDLE_SECONDS)
  const touched = useRef(Date.now())
  const limit = useRef(IDLE_SECONDS)
  const venue = cfg.settings.venueName

  useEffect(() => { let dead = false; reservation.then(r => { if (!dead) setRes(r) }, () => { if (!dead) setRes(null) }); return () => { dead = true } }, [reservation])

  // 45 s of no touch -> continue (shorter once sent)
  useEffect(() => {
    const bump = () => { touched.current = Date.now() }
    window.addEventListener('pointerdown', bump, true); window.addEventListener('keydown', bump, true)
    const t = setInterval(() => {
      const rem = limit.current - (Date.now() - touched.current) / 1000
      setLeft(Math.max(0, Math.ceil(rem)))
      if (rem <= 0) onDone()
    }, 500)
    return () => { clearInterval(t); window.removeEventListener('pointerdown', bump, true); window.removeEventListener('keydown', bump, true) }
  }, [onDone])
  useEffect(() => { limit.current = status === 'sent' ? SENT_SECONDS : IDLE_SECONDS; touched.current = Date.now() }, [status])

  // wipe the address from memory when we leave
  useEffect(() => () => { setEmail(''); setConsent(false); setMarketing(false) }, [])

  const valid = isEmail(email)
  const canSend = valid && consent && status !== 'sending' && !!res
  const send = async () => {
    if (!canSend || !res) return
    setStatus('sending')
    try {
      const r = await window.booth.share.email(res.shareId, email.trim(), true, marketing)
      if (r?.queued) { setStatus('sent'); setEmail(''); setConsent(false); setMarketing(false) } else setStatus('error')
    } catch { setStatus('error') }
  }
  const type = (k: string) => { if (status === 'sent') return; setStatus(s => (s === 'error' ? 'idle' : s)); setEmail(e => (e + k).slice(0, 120)) }
  const back = () => setEmail(e => e.slice(0, -1))

  const qr = useMemo(() => (res ? <QrTile text={res.guestUrl} /> : null), [res])

  return (
    <main className="k-screen k-share">
      <h1 className="share-title">take it with you</h1>
      <div className="share-cards">
        <section className="share-card share-qr-card" aria-labelledby="share-qr-h">
          {res === undefined && <p className="share-note">getting your link…</p>}
          {res === null && <p className="share-note">sharing isn't available right now. your print is in the tray!</p>}
          {res && <div className="share-qr-tile">{qr}</div>}
          {res !== null && <p id="share-qr-h" className="share-cap">scan to get your photo on your phone</p>}
        </section>

        {res !== null && (
          <section className="share-card share-form" aria-labelledby="share-email-h">
            <h2 id="share-email-h">or get the link by email</h2>
            {status === 'sent' ? (
              <div className="share-ok" role="status" aria-live="polite">
                <div className="tick" aria-hidden="true">✓</div>
                <h3>check your inbox</h3>
                <p>we've sent your link and we've forgotten your address.</p>
              </div>
            ) : (
              <>
                <label className="share-label" htmlFor="share-email">your email</label>
                <input id="share-email" className="share-input" type="email" inputMode="none" autoComplete="off" autoCapitalize="none"
                  spellCheck={false} placeholder="name@example.com" value={email} aria-invalid={email.length > 3 && !valid}
                  onChange={e => { setEmail(e.target.value.toLowerCase().replace(/\s/g, '')); if (status === 'error') setStatus('idle') }} />
                <OnScreenKeyboard onKey={type} onBackspace={back} />
                <label className="share-check">
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />
                  <span className="box" aria-hidden="true" />
                  <span>email me my photo link and delete my email afterwards — i agree to the privacy notice</span>
                </label>
                <label className="share-check">
                  <input type="checkbox" checked={marketing} onChange={e => setMarketing(e.target.checked)} />
                  <span className="box" aria-hidden="true" />
                  <span>also send me news and offers from {venue}</span>
                </label>
              </>
            )}
            <div className="share-status" role="status" aria-live="polite">
              {status === 'error' && <span className="share-err">hmm, that didn't send. check the address and try again, or just scan the code.</span>}
              {status === 'sending' && <span>sending…</span>}
            </div>
          </section>
        )}
      </div>
      <div className="row share-actions">
        {status !== 'sent' && res !== null && (
          <button className="im-btn big share-send" onClick={send} disabled={!canSend}>{status === 'sending' ? 'sending…' : 'send'}</button>
        )}
        <button className={`im-btn ${status === 'sent' || res === null ? 'big' : 'ghost'}`} onClick={onDone}>{status === 'sent' ? 'done' : 'no thanks / done'}</button>
      </div>
      <p className="share-timer" aria-hidden="true">{left <= 15 ? `continuing in ${left}s` : ''}</p>
    </main>
  )
}
