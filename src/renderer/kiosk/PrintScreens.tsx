import { useEffect, useState } from 'react'
import Wordmark from './Wordmark'

export function PrintingScreen({ error, copies, onRetry, onBack }: { error?: string; copies: number; onRetry: () => void; onBack: () => void }) {
  const [p, setP] = useState(4)
  useEffect(() => {
    if (error) return
    setP(4)
    const t = setInterval(() => setP(v => Math.min(92, v + (96 - v) * 0.05)), 200)
    return () => clearInterval(t)
  }, [error])
  if (error) {
    return (
      <main className="k-screen k-printing">
        <div className="print-card">
          <div className="oops">!</div>
          <h2>our printer needs a moment</h2>
          <p>your photo is safe. try again, or ask a team member to help.</p>
          <p className="ask">ask staff for help</p>
          <div className="row">
            <button className="im-btn ghost" onClick={onBack}>back to my print</button>
            <button className="im-btn big" onClick={onRetry}>try again</button>
          </div>
        </div>
      </main>
    )
  }
  return (
    <main className="k-screen k-printing">
      <div className="print-card">
        <div className="printer-anim" aria-hidden="true"><i /><i /><i /></div>
        <h2>printing {copies > 1 ? `${copies} copies` : 'your photo'}</h2>
        <div className="bar"><div style={{ width: `${p}%` }} /></div>
        <p>hang tight, it will be ready in the tray in a moment</p>
      </div>
    </main>
  )
}

export function ThanksScreen({ venue, seconds, onDone }: { venue?: string; seconds: number; onDone: () => void }) {
  return (
    <main className="k-screen k-thanks" onPointerDown={onDone}>
      <Wordmark size={110} />
      <h1>you're part of the story now</h1>
      <p>grab your print from the tray{venue ? `, and thank you for visiting ${venue}` : ''}.</p>
      <div className="thanks-timer"><div style={{ animationDuration: `${seconds}s` }} /></div>
      <button className="im-btn big" onClick={onDone}>done</button>
    </main>
  )
}
