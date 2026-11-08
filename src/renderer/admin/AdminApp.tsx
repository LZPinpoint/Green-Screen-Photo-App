import React, { useEffect, useState } from 'react'
import '../theme/imagine.css'
import './admin.css'
import { Wordmark } from './ui'
import Dashboard from './tabs/Dashboard'
import GreenScreen from './tabs/GreenScreen'
import Hardware from './tabs/Hardware'
import Scenes from './tabs/Scenes'
import Layouts from './tabs/Layouts'
import Settings from './tabs/Settings'
import TestLab from './tabs/TestLab'
import Sharing from './tabs/Sharing'

interface TabDef { id: string; label: string; render(): React.ReactNode }
const TABS: TabDef[] = [
  { id: 'dashboard', label: 'dashboard', render: () => <Dashboard /> },
  { id: 'green', label: 'green screen', render: () => <GreenScreen /> },
  { id: 'hardware', label: 'hardware', render: () => <Hardware /> },
  { id: 'scenes', label: 'scenes', render: () => <Scenes /> },
  { id: 'layouts', label: 'layouts', render: () => <Layouts /> },
  { id: 'sharing', label: 'sharing', render: () => <Sharing /> },
  { id: 'settings', label: 'settings', render: () => <Settings /> },
  { id: 'testlab', label: 'test lab', render: () => <TestLab /> }
]

export default function AdminApp({ onExit }: { onExit(): void }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('imagine.admin.tab') || 'dashboard' } catch { return 'dashboard' } })
  useEffect(() => { try { sessionStorage.setItem('imagine.admin.tab', tab) } catch { /* ignore */ } }, [tab])
  const cur = TABS.find(t => t.id === tab) ?? TABS[0]
  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex(t => t.id === cur.id)
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
    if (n >= 0) { setTab(TABS[(n + TABS.length) % TABS.length].id); e.preventDefault() }
  }
  return (
    <div className="ad">
      <header className="ad-top">
        <Wordmark /><span className="ad-sub">admin</span><span className="sp" />
        <button className="ad-btn sm" style={{ background: '#fff', color: '#B80021' }} onClick={onExit}>exit to booth</button>
      </header>
      <nav className="ad-tabs" role="tablist" aria-label="admin sections" onKeyDown={onKey}>
        {TABS.map(t => <button key={t.id} id={`tab-${t.id}`} role="tab" className="ad-tab" aria-selected={t.id === cur.id} aria-controls="ad-panel" tabIndex={t.id === cur.id ? 0 : -1} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      <main className="ad-main" id="ad-panel" role="tabpanel" aria-labelledby={`tab-${cur.id}`}>{cur.render()}</main>
    </div>
  )
}
