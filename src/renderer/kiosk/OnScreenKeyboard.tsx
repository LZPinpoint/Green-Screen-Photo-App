// Touch keyboard for email entry (the kiosk has no physical keyboard). Lowercase only, no shift.
const ROWS: string[][] = [
  '1234567890'.split(''),
  'qwertyuiop'.split(''),
  'asdfghjkl'.split(''),
  'zxcvbnm'.split('')
]

export default function OnScreenKeyboard({ onKey, onBackspace }: { onKey: (k: string) => void; onBackspace: () => void }) {
  // keep focus on the email field: never let a key press steal it
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault()
  const key = (k: string, label = k, cls = '') => (
    <button key={k} type="button" className={`osk-key ${cls}`} onPointerDown={keep} onMouseDown={keep}
      onClick={() => onKey(k)} aria-label={k.startsWith('.') && k.length > 1 ? 'dot com' : k === '@' ? 'at sign' : k === '.' ? 'dot' : k === '-' ? 'dash' : k === '_' ? 'underscore' : k}>
      {label}
    </button>
  )
  return (
    <div className="osk" role="group" aria-label="on-screen keyboard">
      {ROWS.map((row, i) => (
        <div className="osk-row" key={i}>
          {row.map(k => key(k))}
          {i === ROWS.length - 1 && (
            <button type="button" className="osk-key wide" aria-label="backspace" onPointerDown={keep} onMouseDown={keep} onClick={onBackspace}>⌫</button>
          )}
        </div>
      ))}
      <div className="osk-row">
        {key('@', '@', 'accent')}{key('.')}{key('-')}{key('_')}{key('.com', '.com', 'wide2')}
      </div>
    </div>
  )
}
