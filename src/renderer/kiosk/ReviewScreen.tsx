import { Spinner } from './Chrome'
import { aiLabel, useAiPhase } from '../keying/aiBridge'
import SceneCanvas from './SceneCanvas'
import type { Cfg, Shot } from './types'

export default function ReviewScreen({ cfg, shot, index, onRetake, onContinue }: {
  cfg: Cfg; shot?: Shot; index: number; onRetake: () => void; onContinue: () => void
}) {
  const total = cfg.layout.photosPerSheet
  const ai = useAiPhase()
  const last = index + 1 >= total
  return (
    <main className="k-screen k-review">
      <div className="review-stage im-card">
        {shot?.keyed
          ? <SceneCanvas keyed={shot.keyed} scene={cfg.scenes[0]} className="review-canvas" />
          : shot?.failed
            ? <p className="soft">hmm, that one didn't come out. let's try again.</p>
            : <Spinner label={ai !== 'idle' ? aiLabel(ai) : 'removing the background'} />}
        {total > 1 && <div className="pose-badge">photo {index + 1} of {total}</div>}
      </div>
      <div className="review-bar">
        <h2>{shot?.keyed ? 'looking good!' : 'one moment...'}</h2>
        {shot?.keyed && shot.note && shot.engine !== 'chroma' && <p className="pose-hint">{shot.engine === 'ai' || shot.engine === 'hybrid' ? 'cut out with ai' : shot.note}</p>}
        {shot?.keyed && shot.engine === 'chroma' && /failed|longer than|not available/.test(shot.note ?? '') && <p className="pose-warn">ai cutout unavailable, so this uses the green screen key</p>}
        <div className="row">
          <button className="im-btn ghost" onClick={onRetake}>retake</button>
          <button className="im-btn big" onClick={onContinue} disabled={!shot?.keyed}>
            {last ? 'choose your world' : 'next photo'}
          </button>
        </div>
      </div>
    </main>
  )
}
