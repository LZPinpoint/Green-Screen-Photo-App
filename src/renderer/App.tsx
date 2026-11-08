import { Suspense, lazy, useEffect, useRef, useState, Component, type ReactNode } from 'react'
import KioskApp from './kiosk/KioskApp'
import PinPad from './kiosk/PinPad'
import Wordmark from './kiosk/Wordmark'
import StaffApp from './staff/StaffApp'
import DisplayView from './staff/DisplayView'
import DemoGallery, { galleryIdFromHash } from './DemoGallery'
import './staff/staff.css'

type Screen = 'main' | 'pin' | 'admin'
type Which = 'staff' | 'kiosk'

const AdminApp = lazy(async () => {
  try {
    // the admin module is written separately; a missing/broken module must never take the kiosk down
    return await import('./admin/AdminApp') as { default: (p: { onExit(): void }) => ReactNode } as never
  } catch {
    return { default: ({ onExit }: { onExit(): void }) => (
      <div className="err-card"><h2>admin isn't available</h2><p>the admin screen could not be loaded.</p>
        <button className="im-btn" onClick={onExit}>back</button></div>
    ) } as never
  }
})

class Boundary extends Component<{ onExit(): void; children: ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  render() {
    return this.state.err
      ? <div className="err-card"><h2>admin hit a snag</h2><button className="im-btn" onClick={this.props.onExit}>back</button></div>
      : this.props.children
  }
}

const isDisplayHash = () => /^#\/display\b/.test(location.hash)
/** ?mode=kiosk|staff, or #/kiosk | #/staff */
function urlMode(): Which | null {
  try {
    const q = new URLSearchParams(location.search).get('mode')
    if (q === 'kiosk' || q === 'staff') return q
  } catch { /* ignore */ }
  const m = location.hash.match(/^#\/(kiosk|staff)\b/)
  return m ? (m[1] as Which) : null
}
const rememberMode = (w: Which) => {
  try { const u = new URL(location.href); u.searchParams.set('mode', w); history.replaceState(null, '', u.toString()) } catch { /* ignore */ }
}

function ModeChooser({ onPick }: { onPick(w: Which): void }) {
  return (
    <main className="mode-pick">
      <Wordmark size={72} />
      <h1>how will you run the booth today?</h1>
      <div className="cards">
        <button className="mode-card primary" onClick={() => onPick('staff')} autoFocus>
          <b>staff mode</b>
          <span>an attendant lines each group up in front of the green screen and presses capture. fast, one picture per party, line after line.</span>
          <small>RECOMMENDED · LAPTOP OR TABLET</small>
        </button>
        <button className="mode-card" onClick={() => onPick('kiosk')}>
          <b>self-serve booth</b>
          <span>guests walk up, tap, pose, pick a scene and print on their own. no attendant needed.</span>
          <small>TOUCH KIOSK</small>
        </button>
      </div>
      <p className="note">demo mode · nothing is uploaded or emailed · you can switch any time from the corner</p>
    </main>
  )
}

function DemoSwitch({ which, onPick }: { which: Which; onPick(w: Which): void }) {
  return (
    <div className={`demo-switch${which === 'staff' ? ' top' : ''}`} role="group" aria-label="demo mode" title="demo mode · nothing is uploaded or emailed">
      <span>{which === 'staff' ? 'demo' : 'demo · nothing is uploaded'}</span>
      <button aria-pressed={which === 'staff'} onClick={() => onPick('staff')}>staff</button>
      <button aria-pressed={which === 'kiosk'} onClick={() => onPick('kiosk')}>self-serve</button>
    </div>
  )
}

export default function App({ demo = false }: { demo?: boolean }) {
  const forced = useRef(urlMode())
  const [which, setWhich] = useState<Which | null>(forced.current)
  const [screen, setScreen] = useState<Screen>('main')
  const [display, setDisplay] = useState(isDisplayHash)
  const taps = useRef<number[]>([])
  const [galleryId, setGalleryId] = useState<string | null>(() => (demo ? galleryIdFromHash(location.hash) : null))
  useEffect(() => {
    const on = () => { setDisplay(isDisplayHash()); if (demo) setGalleryId(galleryIdFromHash(location.hash)) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [demo])

  // Electron: settings.mode picks the console ('staff' by default); a ?mode= override wins
  const readMode = () => window.booth.settings.get().then(s => setWhich(s.mode === 'kiosk' ? 'kiosk' : 'staff')).catch(() => setWhich('staff'))
  useEffect(() => { if (!demo && !display && which === null) void readMode() }, [demo, display, which])  // eslint-disable-line react-hooks/exhaustive-deps

  // hidden entry for the self-serve kiosk: 5 taps in the top-left corner within 3 seconds
  const tap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter(t => now - t < 3000), now]
    if (taps.current.length >= 5) { taps.current = []; setScreen('pin') }
  }
  useEffect(() => { if (screen === 'main') taps.current = [] }, [screen])

  const pick = (w: Which) => { setWhich(w); setScreen('main'); if (demo) rememberMode(w) }
  const exitAdmin = () => {
    setScreen('main')
    // settings may have changed the operating mode (not in demo, where the corner switcher decides, nor with a ?mode= override)
    if (!demo && !forced.current) void readMode()
  }

  if (display) return <DisplayView />
  if (galleryId) return <DemoGallery id={galleryId} />
  if (screen === 'admin') {
    return (
      <Boundary onExit={exitAdmin}>
        <Suspense fallback={<div className="err-card"><p>loading admin...</p></div>}>
          <AdminApp onExit={exitAdmin} />
        </Suspense>
      </Boundary>
    )
  }
  if (which === null) return demo ? <ModeChooser onPick={pick} /> : <div style={{ position: 'fixed', inset: 0, background: '#181818' }} />

  if (which === 'staff') {
    return (
      <>
        <StaffApp onAdmin={() => setScreen('admin')} onSwitchToKiosk={() => pick('kiosk')} />
        {demo && <DemoSwitch which="staff" onPick={pick} />}
      </>
    )
  }
  return (
    <>
      <KioskApp />
      <button className="hot-corner" aria-label="" tabIndex={-1} onPointerDown={tap} />
      {screen === 'pin' && <PinPad onCancel={() => setScreen('main')} onOk={() => setScreen('admin')} />}
      {demo && <DemoSwitch which="kiosk" onPick={pick} />}
    </>
  )
}
