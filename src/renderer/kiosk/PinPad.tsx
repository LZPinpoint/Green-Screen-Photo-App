import { useState } from 'react'
import { DEFAULT_SETTINGS } from '../../shared/types'

export default function PinPad({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  const press = async (d: string) => {
    const next = (pin + d).slice(0, 8)
    setPin(next); setErr('')
    let expected = DEFAULT_SETTINGS.adminPin
    try { expected = (await window.booth.settings.get()).adminPin } catch { /* use default */ }
    if (next === expected) onOk()
    else if (next.length >= expected.length) { setErr('wrong pin'); setTimeout(() => setPin(''), 350) }
  }

  return (
    <div className="pin-wrap" onPointerDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="pin-card">
        <h3>staff access</h3>
        <div className="pin-dots">{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        <p className="pin-err">{err}</p>
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button key={d} onClick={() => press(d)}>{d}</button>)}
          <button onClick={() => { setPin(''); setErr('') }} aria-label="clear">c</button>
          <button onClick={() => press('0')}>0</button>
          <button onClick={onCancel} aria-label="cancel">x</button>
        </div>
      </div>
    </div>
  )
}
