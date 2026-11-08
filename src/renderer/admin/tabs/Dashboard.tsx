import React, { useEffect, useState } from 'react'
import { Chip, LibImg, useLoad } from '../ui'
import { niceMax, realSessions, sessionLabel, sessionsToday, shapeByDay, topScenes } from '../helpers'
import type { CameraDevice, PrinterDevice, Session } from '../../../shared/types'

function BarChart({ data }: { data: { day: string; label: string; count: number }[] }) {
  const W = 760, H = 220, L = 36, B = 28, T = 12
  const max = niceMax(Math.max(...data.map(d => d.count), 0))
  const bw = (W - L) / data.length
  const total = data.reduce((a, d) => a + d.count, 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`sessions per day, last ${data.length} days, ${total} total`}>
      <title>sessions per day</title>
      {[0, 0.5, 1].map(f => { const y = T + (H - B - T) * (1 - f); return <g key={f}><line x1={L} x2={W} y1={y} y2={y} stroke="#3a3a3a" /><text x={L - 8} y={y + 4} textAnchor="end" fill="#a8a8a8" fontSize="11">{Math.round(max * f)}</text></g> })}
      {data.map((d, i) => {
        const h = (H - B - T) * d.count / max, x = L + i * bw + bw * 0.18, y = H - B - h, last = i === data.length - 1
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={bw * 0.64} height={Math.max(h, d.count ? 2 : 0)} rx={6} fill={last ? '#e0153b' : '#B80021'}><title>{`${d.day}: ${d.count} sessions`}</title></rect>
            {d.count > 0 && <text x={x + bw * 0.32} y={y - 4} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{d.count}</text>}
            {(i % 2 === (data.length - 1) % 2) && <text x={x + bw * 0.32} y={H - 10} textAnchor="middle" fill="#a8a8a8" fontSize="11">{d.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

export default function Dashboard() {
  const stats = useLoad(() => window.booth.stats.summary())
  const scenes = useLoad(() => window.booth.library.scenes())
  const sessions = useLoad(() => window.booth.session.list(8))
  const hw = useLoad(async () => {
    const [cams, prs] = await Promise.all([
      window.booth.camera.list().catch(() => [] as CameraDevice[]),
      window.booth.printer.list().catch(() => [] as PrinterDevice[])
    ])
    return { cams, prs }
  })
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => { stats.reload(); sessions.reload(); hw.reload(); tick(n => n + 1) }, 15000); return () => clearInterval(t) }, [])

  const s = stats.data
  const names = Object.fromEntries((scenes.data ?? []).map(x => [x.id, x.name]))
  const top = s ? topScenes(s.byScene, names, 5) : []
  const topMax = Math.max(1, ...top.map(t => t.count))
  const settings = useLoad(() => window.booth.settings.get())
  const cam = hw.data?.cams.find(c => c.id === settings.data?.cameraId) ?? hw.data?.cams[0]
  const pr = hw.data?.prs.find(p => p.name === settings.data?.printerName) ?? hw.data?.prs.find(p => p.isDefault) ?? hw.data?.prs[0]
  const prTone = !pr ? 'bad' : pr.status === 'ready' ? 'ok' : pr.status === 'busy' ? 'warn' : pr.status === 'offline' ? 'bad' : 'idle'

  return (
    <div className="ad-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <div className="ad-card"><div className="ad-stat">{s ? sessionsToday(s) : '–'}<small>sessions today</small></div></div>
      <div className="ad-card"><div className="ad-stat">{s?.sessions ?? '–'}<small>sessions total</small></div></div>
      <div className="ad-card"><div className="ad-stat">{s?.prints ?? '–'}<small>prints total</small></div></div>
      <div className="ad-card">
        <h3>hardware</h3>
        <div className="ad-row">
          <Chip tone={cam ? 'ok' : 'bad'}>camera: {cam ? cam.label : 'none found'}</Chip>
          <Chip tone={prTone}>printer: {pr ? `${pr.displayName} · ${pr.status}` : 'none found'}</Chip>
        </div>
      </div>

      <div className="ad-card" style={{ gridColumn: 'span 3' }}>
        <h3>sessions per day · last 14 days</h3>
        {s ? <BarChart data={shapeByDay(s.byDay, 14)} /> : <p className="ad-muted">loading…</p>}
        {stats.error && <p className="ad-bad">{stats.error}</p>}
      </div>
      <div className="ad-card">
        <h3>top scenes</h3>
        {top.length === 0 && <p className="ad-muted">no sessions yet</p>}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {top.map(t => (
            <li key={t.id} style={{ margin: '10px 0' }}>
              <div className="ad-row sp"><span>{t.name}</span><b>{t.count}</b></div>
              <div className="ad-bar" role="presentation"><i style={{ width: `${(t.count / topMax) * 100}%` }} /></div>
            </li>
          ))}
        </ol>
      </div>

      <div className="ad-card" style={{ gridColumn: 'span 4' }}>
        <h3>recent sessions</h3>
        <RecentSessions list={realSessions(sessions.data ?? [])} sceneNames={names} />
      </div>
    </div>
  )
}

function RecentSessions({ list, sceneNames }: { list: Session[]; sceneNames: Record<string, string> }) {
  if (!list.length) return <p className="ad-muted">nothing yet — the first guest will show up here.</p>
  return (
    <div className="ad-grid" style={{ gridTemplateColumns: 'repeat(8, 1fr)', gap: 12 }}>
      {list.map(se => (
        <figure key={se.id} style={{ margin: 0 }}>
          <LibImg file={se.composite ?? se.shots[0]?.keyed ?? se.shots[0]?.raw} alt={`session ${sessionLabel(se)}`} />
          <figcaption style={{ fontSize: 12, marginTop: 6 }}>
            {sessionLabel(se)}<br /><span className="ad-muted">{se.sceneId ? sceneNames[se.sceneId] ?? se.sceneId : 'no scene'} · {se.printed} print{se.printed === 1 ? '' : 's'}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
