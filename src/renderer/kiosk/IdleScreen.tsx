import { useEffect, useState } from 'react'
import Wordmark from './Wordmark'
import { assetUrl } from './assets'
import type { Cfg } from './types'

/** attract loop: slow cross-fading scenes behind the wordmark and a pulsing call to action */
export default function IdleScreen({ cfg, onTouch }: { cfg: Cfg | null; onTouch: () => void }) {
  const files = (cfg?.scenes ?? []).map(s => s.file)
  const [urls, setUrls] = useState<string[]>([])
  const [i, setI] = useState(0)

  useEffect(() => {
    let dead = false
    Promise.all(files.map(f => assetUrl(f).catch(() => ''))).then(u => { if (!dead) setUrls(u.filter(Boolean)) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.join('|')])

  useEffect(() => {
    if (urls.length < 2) return
    const t = setInterval(() => setI(n => (n + 1) % urls.length), 5200)
    return () => clearInterval(t)
  }, [urls.length])

  return (
    <main className="k-screen k-idle" onPointerDown={onTouch} role="button" aria-label="touch to begin">
      <div className="idle-bg">
        {urls.map((u, n) => <div key={n} className={`idle-slide ${n === i ? 'on' : ''}`} style={{ backgroundImage: `url(${u})` }} />)}
        <div className="idle-shade" />
      </div>
      <div className="idle-content">
        <Wordmark size={170} className="idle-logo" />
        <h1>{cfg?.settings.welcomeText ?? 'step into the story'}</h1>
        <p className="idle-sub">become part of the exhibit</p>
        <div className="idle-cta"><span>touch to begin</span></div>
        {cfg?.settings.venueName && <p className="idle-venue">{cfg.settings.venueName}</p>}
      </div>
    </main>
  )
}
