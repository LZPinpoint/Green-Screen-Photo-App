// The 'imagine' wordmark as pure text + CSS: lowercase geometric type with a red dot over the 'i'.
// No image dependency, so the kiosk and the web demo never rely on a download.

export default function Wordmark({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`wordmark ${className}`} style={{ fontSize: size }} aria-label="imagine">
      <span className="wm-i" aria-hidden="true">
        ı<span className="wm-dot" />
      </span>
      <span aria-hidden="true">magine</span>
    </span>
  )
}
