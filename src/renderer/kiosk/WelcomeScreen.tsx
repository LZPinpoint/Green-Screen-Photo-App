import type { Cfg } from './types'

export default function WelcomeScreen({ cfg, shareEnabled = false, onConsent, onBack }: { cfg: Cfg | null; shareEnabled?: boolean; onConsent: () => void; onBack: () => void }) {
  const days = cfg?.settings.share?.retentionDays ?? 30
  const venue = cfg?.settings.venueName ?? 'this venue'
  const n = cfg?.layout.photosPerSheet ?? 1
  return (
    <main className="k-screen k-welcome">
      <div className="welcome-card">
        <p className="eyebrow">welcome to {venue}</p>
        <h2>ready to become part of the exhibit?</h2>
        <ol className="how">
          <li><b>1</b><span>stand in front of the green screen</span></li>
          <li><b>2</b><span>{n > 1 ? `strike ${n} poses` : 'strike a pose'}, we take the photo</span></li>
          <li><b>3</b><span>pick your world and print it</span></li>
        </ol>
        <p className="privacy">
          {shareEnabled
            ? `your photo is uploaded to a private link so you can download it on your phone. we keep it for ${days} days, and you can delete it any time from that page. it is deleted from this screen when you finish.`
            : 'your photo is only used to make your print. it is not shared and is deleted from this screen when you finish.'}
        </p>
        <div className="row">
          <button className="im-btn ghost" onClick={onBack}>back</button>
          <button className="im-btn big" onClick={onConsent}>sounds good, let's go</button>
        </div>
      </div>
    </main>
  )
}
