import { useEffect, useState } from 'react'
import { layoutSheet, qrMatrix } from '@core/index'
// @ts-ignore vite asset import (url string); no ambient types for relative paths
import logoUrl from '../../../resources/logos/imagine-white.png?url'
import { composeShot } from './assets'
import { dataUrlToImageData, imageDataToDataUrl, toImageData, type Pixels } from './imaging'
import { Spinner } from './Chrome'
import type { Cfg, Shot } from './types'

/** the shipped logo is white-on-transparent; tint it near-black so it shows on the white print footer */
async function darkLogo(): Promise<ImageData> {
  const src = await dataUrlToImageData(logoUrl, 600)
  const d = src.data
  for (let i = 0; i < d.length; i += 4) { if (d[i] > d[i + 1] + 60) continue; d[i] = 24; d[i + 1] = 24; d[i + 2] = 24 } // keep the red dot
  return src
}

/** Builds the final print sheet (layoutSheet) and lets the guest pick copies. */
export default function PreviewScreen({ cfg, shots, sceneId, frameId, copies, maxCopies, shareEnabled = false, reserve, onCopies, onSheet, onPrint, onBack }: {
  shareEnabled?: boolean; reserve?: () => Promise<{ shareId: string; guestUrl: string } | null>
  cfg: Cfg; shots: Shot[]; sceneId?: string; frameId?: string; copies: number; maxCopies: number
  onCopies: (n: number) => void; onSheet: (dataUrl: string) => void; onPrint: () => void; onBack: () => void
}) {
  const [sheet, setSheet] = useState('')
  const [err, setErr] = useState(false)

  useEffect(() => {
    let dead = false
    setSheet(''); setErr(false)
    ;(async () => {
      try {
        const scene = cfg.scenes.find(s => s.id === sceneId)!
        const frame = cfg.frames.find(f => f.id === frameId)
        const [outW, outH] = cfg.layout.photosPerSheet === 1 ? [1200, 1800] : [800, 1200]
        const comps = await Promise.all(shots.map(s => composeShot({ keyed: s.keyed!, scene, frameFile: frame?.file, outW, outH })))
        const logo = cfg.layout.showLogo ? await darkLogo().catch(() => undefined) : undefined
        await new Promise(r => setTimeout(r, 30))
        // reserve the guest link first so its QR can be printed on the sheet; never block or fail printing over it
        let qr: boolean[][] | undefined
        if (shareEnabled && reserve) {
          try { const r = await reserve(); if (r && cfg.layout.qrCode) qr = qrMatrix(r.guestUrl) } catch { qr = undefined }
        }
        const out = layoutSheet(cfg.layout, comps as never[], { logo, qr, footerText: cfg.layout.footerText ?? cfg.settings.venueName } as never) as unknown as Pixels
        const url = imageDataToDataUrl(toImageData(out), 'image/jpeg', 0.92)
        if (!dead) { setSheet(url); onSheet(url) }
      } catch { if (!dead) setErr(true) }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, shots, sceneId, frameId, shareEnabled])

  return (
    <main className="k-screen k-preview">
      <div className={`sheet-stage size-${cfg.layout.size}`}>
        {sheet ? <img src={sheet} alt="your print" className="sheet" /> : err
          ? <p className="soft">we couldn't build your print. please go back and try again.</p>
          : <Spinner label="laying out your print" />}
      </div>
      <div className="preview-panel">
        <h2>that's a keeper!</h2>
        <div className="copies">
          <span className="label">copies</span>
          <div className="stepper">
            <button aria-label="fewer copies" onClick={() => onCopies(copies - 1)} disabled={copies <= 1}>-</button>
            <b>{copies}</b>
            <button aria-label="more copies" onClick={() => onCopies(copies + 1)} disabled={copies >= maxCopies}>+</button>
          </div>
          <span className="note">{maxCopies > 1 ? `up to ${maxCopies} per visit` : 'one print per visit'}</span>
        </div>
        <div className="row">
          <button className="im-btn ghost" onClick={onBack}>change scene</button>
          <button className="im-btn big" onClick={onPrint} disabled={!sheet}>print it</button>
        </div>
      </div>
    </main>
  )
}
