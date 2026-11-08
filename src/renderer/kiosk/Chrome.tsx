import type { ReactNode } from 'react'
import Wordmark from './Wordmark'
import type { Screen } from './flow'

const STEPS: Screen[] = ['pose', 'review', 'scenes', 'preview', 'printing']
const stepIndex = (s: Screen) => (s === 'welcome' ? -1 : s === 'thanks' ? STEPS.length : s === 'share' ? STEPS.indexOf('printing') : STEPS.indexOf(s))

/** Small header: wordmark, progress dots, start over. */
export function Header({ screen, onStartOver }: { screen: Screen; onStartOver: () => void }) {
  const cur = stepIndex(screen)
  return (
    <header className="k-header">
      <Wordmark size={34} />
      <div className="k-dots" aria-hidden="true">
        {STEPS.map((_, i) => <i key={i} className={i < cur ? 'done' : i === cur ? 'on' : ''} />)}
      </div>
      {screen !== 'thanks' && screen !== 'printing' && screen !== 'share'
        ? <button className="k-link" onClick={onStartOver}>start over</button>
        : <span className="k-link-spacer" />}
    </header>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="k-spin-wrap">
      <div className="k-spin" />
      {label && <p>{label}</p>}
    </div>
  )
}

export function Screen({ name, children }: { name: string; children: ReactNode }) {
  return <main className={`k-screen k-${name}`} key={name}>{children}</main>
}
