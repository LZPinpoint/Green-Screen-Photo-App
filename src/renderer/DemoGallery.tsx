// Public-demo twin of the cloud guest gallery (cloud/src/html/gallery.ts). Reads the photo the demo kiosk stored in localStorage.
import { useEffect, useState } from 'react'
import { DEMO_PHOTO_PREFIX } from './mockBooth'
import './gallery.css'

export const galleryIdFromHash = (h: string): string | null => {
  const m = /^#\/g\/([\w-]{3,64})\/?$/.exec(h)
  return m ? m[1] : null
}

export default function DemoGallery({ id }: { id: string }) {
  const [photo] = useState<string | null>(() => { try { return localStorage.getItem(DEMO_PHOTO_PREFIX + id) } catch { return null } })
  const [copied, setCopied] = useState(false)
  const [canShare, setCanShare] = useState(false)
  useEffect(() => { document.title = 'my photo · imagine'; setCanShare(typeof navigator !== 'undefined' && !!navigator.share) }, [])
  const url = location.href
  const text = 'my photo from the imagine museum'
  const u = encodeURIComponent

  const share = async () => {
    try {
      if (photo) {
        const b = await (await fetch(photo)).blob()
        const f = new File([b], 'imagine-photo.jpg', { type: b.type })
        if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: text, url }); return }
      }
      await navigator.share({ title: text, url })
    } catch { /* cancelled */ }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { window.prompt('copy this link', url) }
  }

  return (
    <div className="g-page">
      <div className="g-bar"><span className="g-mark">imagine<i /></span></div>
      <main className="g-main">
        <h1>the imagine museum</h1>
        <p className="g-lead">step into the story</p>
        {photo ? (
          <>
            <img className="g-photo" src={photo} alt="your photo from the imagine museum" />
            <div className="g-actions"><a className="g-btn primary block" href={photo} download="imagine-photo.jpg">download full resolution</a></div>
            <h2>share it</h2>
            <ul className="g-share">
              {canShare && <li><button type="button" className="g-btn primary" onClick={share}>share…</button></li>}
              <li><a className="g-btn" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${u(text + ' ' + url)}`}>whatsapp</a></li>
              <li><a className="g-btn" target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${u(text)}&url=${u(url)}`}>x</a></li>
              <li><button type="button" className="g-btn" onClick={copy}>{copied ? 'copied!' : 'copy link'}</button></li>
            </ul>
          </>
        ) : (
          <div className="g-missing" role="status">
            <p>this demo photo isn't here.</p>
            <p>demo photos live only in the browser that made them, and the last few are kept.</p>
          </div>
        )}
        <p className="g-demo"><b>demo</b> — this page mimics the real guest gallery. nothing was uploaded and no email is sent; the photo never left this browser.</p>
      </main>
      <footer className="g-foot">
        <p>in the real thing it is available for 30 days, then deleted for good.</p>
        <p>no tracking, no ads, no cookies.</p>
        <p><a href="#" onClick={e => { e.preventDefault(); location.hash = '' }}>back to the booth</a></p>
      </footer>
    </div>
  )
}
