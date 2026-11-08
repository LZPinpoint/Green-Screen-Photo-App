// Public-demo twin of the cloud guest gallery (cloud/src/html/gallery.ts). Reads the photo the demo kiosk stored in localStorage.
import { useEffect, useState } from 'react'
import { DEMO_PHOTO_PREFIX } from './mockBooth'
import './gallery.css'

export const galleryIdFromHash = (h: string): string | null => {
  const m = /^#\/g\/([\w-]{3,64})\/?$/.exec(h)
  return m ? m[1] : null
}

// Shown when the photo isn't in this browser (e.g. the QR was scanned on a phone): a sample so the page still demonstrates the experience.
const SAMPLE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f3a"/><stop offset=".55" stop-color="#b84a12"/><stop offset="1" stop-color="#f2a21a"/></linearGradient></defs>' +
  '<rect width="600" height="900" fill="url(#g)"/><path d="M0 760 L190 520 L330 700 L450 560 L600 760 L600 900 L0 900Z" fill="#1c1210"/>' +
  '<circle cx="300" cy="470" r="58" fill="#d9a37c"/><rect x="238" y="535" width="124" height="190" rx="46" fill="#d9a37c"/><rect x="262" y="700" width="76" height="130" rx="14" fill="#d9a37c"/>' +
  '<text x="300" y="860" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="34" fill="#fff" fill-opacity=".85">sample photo</text></svg>')

export default function DemoGallery({ id }: { id: string }) {
  const [real] = useState<string | null>(() => { try { return localStorage.getItem(DEMO_PHOTO_PREFIX + id) } catch { return null } })
  const photo = real ?? SAMPLE
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
        <img className="g-photo" src={photo} alt={real ? 'your photo from the imagine museum' : 'a sample photo'} />
        <div className="g-actions"><a className="g-btn primary block" href={photo} download="imagine-photo.jpg">download full resolution</a></div>
        <h2>share it</h2>
        <ul className="g-share">
          {canShare && <li><button type="button" className="g-btn primary" onClick={share}>share…</button></li>}
          <li><a className="g-btn" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${u(text + ' ' + url)}`}>whatsapp</a></li>
          <li><a className="g-btn" target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${u(text)}&url=${u(url)}`}>x</a></li>
          <li><button type="button" className="g-btn" onClick={copy}>{copied ? 'copied!' : 'copy link'}</button></li>
        </ul>
        {!real && <p className="g-missing" role="status">this is a sample. on a real booth this page shows your own photo.</p>}
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
