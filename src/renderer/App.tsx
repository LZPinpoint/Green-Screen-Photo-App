import { Suspense, lazy, useEffect, useRef, useState, Component, type ReactNode } from 'react'
import KioskApp from './kiosk/KioskApp'
import PinPad from './kiosk/PinPad'
import DemoGallery, { galleryIdFromHash } from './DemoGallery'

type Mode = 'kiosk' | 'pin' | 'admin'

const AdminApp = lazy(async () => {
  try {
    // the admin module is written separately; a missing/broken module must never take the kiosk down
    return await import('./admin/AdminApp') as { default: (p: { onExit(): void }) => ReactNode } as never
  } catch {
    return { default: ({ onExit }: { onExit(): void }) => (
      <div className="err-card"><h2>admin isn't available</h2><p>the admin screen could not be loaded.</p>
        <button className="im-btn" onClick={onExit}>back to kiosk</button></div>
    ) } as never
  }
})

class Boundary extends Component<{ onExit(): void; children: ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  render() {
    return this.state.err
      ? <div className="err-card"><h2>admin hit a snag</h2><button className="im-btn" onClick={this.props.onExit}>back to kiosk</button></div>
      : this.props.children
  }
}

export default function App({ demo = false }: { demo?: boolean }) {
  const [mode, setMode] = useState<Mode>('kiosk')
  const taps = useRef<number[]>([])
  const [galleryId, setGalleryId] = useState<string | null>(() => (demo ? galleryIdFromHash(location.hash) : null))
  useEffect(() => {
    if (!demo) return
    const on = () => setGalleryId(galleryIdFromHash(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [demo])

  // hidden entry: 5 taps in the top-left corner within 3 seconds
  const tap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter(t => now - t < 3000), now]
    if (taps.current.length >= 5) { taps.current = []; setMode('pin') }
  }
  useEffect(() => { if (mode === 'kiosk') taps.current = [] }, [mode])

  if (galleryId) return <DemoGallery id={galleryId} />
  if (mode === 'admin') {
    return (
      <Boundary onExit={() => setMode('kiosk')}>
        <Suspense fallback={<div className="err-card"><p>loading admin...</p></div>}>
          <AdminApp onExit={() => setMode('kiosk')} />
        </Suspense>
      </Boundary>
    )
  }
  return (
    <>
      <KioskApp />
      <button className="hot-corner" aria-label="" tabIndex={-1} onPointerDown={tap} />
      {mode === 'pin' && <PinPad onCancel={() => setMode('kiosk')} onOk={() => setMode('admin')} />}
      {demo && <div className="demo-badge">demo mode · nothing is uploaded or emailed</div>}
    </>
  )
}
