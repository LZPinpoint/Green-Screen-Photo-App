// Guest flow state machine. Pure + unit-testable. Image bytes live outside the reducer (KioskApp) so a reset can wipe them.

export type Screen = 'idle' | 'welcome' | 'pose' | 'review' | 'scenes' | 'preview' | 'printing' | 'share' | 'thanks'

export interface FlowState {
  screen: Screen
  /** number of shots needed for the active layout (photosPerSheet) */
  shotsNeeded: number
  /** number of shots captured so far */
  shots: number
  /** which captured shot is being reviewed */
  reviewIndex: number
  sceneId?: string
  frameId?: string
  copies: number
  maxCopies: number
  printError?: string
  /** digital delivery (QR + email) is configured: show the share screen after a successful print */
  shareEnabled: boolean
  /** bumps every reset so async work can detect it belongs to a dead session */
  epoch: number
}

export type FlowAction =
  | { type: 'configure'; shotsNeeded?: number; maxCopies?: number; shareEnabled?: boolean }
  | { type: 'touch' }
  | { type: 'consent' }
  | { type: 'captured' }
  | { type: 'retake' }
  | { type: 'continue' }
  | { type: 'pickScene'; id: string }
  | { type: 'pickFrame'; id?: string }
  | { type: 'toPreview' }
  | { type: 'back' }
  | { type: 'setCopies'; copies: number }
  | { type: 'print' }
  | { type: 'printOk' }
  | { type: 'printFail'; error: string }
  | { type: 'done' }
  | { type: 'skip' }
  | { type: 'reset' }
  | { type: 'timeout' }

export const initialFlow = (shotsNeeded = 1, maxCopies = 2): FlowState => ({
  screen: 'idle', shotsNeeded: clamp(shotsNeeded, 1, 4), shots: 0, reviewIndex: 0,
  copies: 1, maxCopies: Math.max(1, maxCopies), shareEnabled: false, epoch: 0
})

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

const fresh = (s: FlowState): FlowState => ({
  ...initialFlow(s.shotsNeeded, s.maxCopies), shareEnabled: s.shareEnabled, epoch: s.epoch + 1
})

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case 'configure': {
      const shotsNeeded = clamp(a.shotsNeeded ?? s.shotsNeeded, 1, 4)
      const maxCopies = Math.max(1, a.maxCopies ?? s.maxCopies)
      return { ...s, shotsNeeded, maxCopies, shareEnabled: a.shareEnabled ?? s.shareEnabled, copies: clamp(s.copies, 1, maxCopies) }
    }
    case 'touch':
      return s.screen === 'idle' ? { ...s, screen: 'welcome' } : s
    case 'consent':
      return s.screen === 'welcome' ? { ...s, screen: 'pose' } : s
    case 'captured': {
      if (s.screen !== 'pose') return s
      const shots = Math.min(s.shots + 1, s.shotsNeeded)
      return { ...s, shots, reviewIndex: shots - 1, screen: 'review' }
    }
    case 'retake': {
      if (s.screen !== 'review') return s
      // drop the shot being reviewed (always the latest) and go shoot it again
      return { ...s, shots: Math.max(0, s.shots - 1), screen: 'pose', reviewIndex: Math.max(0, s.shots - 2) }
    }
    case 'continue': {
      if (s.screen !== 'review') return s
      return s.shots < s.shotsNeeded ? { ...s, screen: 'pose' } : { ...s, screen: 'scenes' }
    }
    case 'pickScene':
      return s.screen === 'scenes' ? { ...s, sceneId: a.id } : s
    case 'pickFrame':
      return s.screen === 'scenes' ? { ...s, frameId: a.id } : s
    case 'toPreview':
      return s.screen === 'scenes' && s.sceneId ? { ...s, screen: 'preview' } : s
    case 'back': {
      switch (s.screen) {
        case 'welcome': return { ...s, screen: 'idle' }
        case 'pose': return s.shots > 0 ? { ...s, screen: 'review' } : { ...s, screen: 'welcome' }
        case 'scenes': return { ...s, screen: 'review', reviewIndex: s.shots - 1 }
        case 'preview': return { ...s, screen: 'scenes' }
        // a failed print can go back to the preview (session kept); mid-print there is no way back
        case 'printing': return s.printError ? { ...s, screen: 'preview', printError: undefined } : s
        default: return s
      }
    }
    case 'setCopies':
      return s.screen === 'preview' ? { ...s, copies: clamp(a.copies, 1, s.maxCopies) } : s
    case 'print':
      return s.screen === 'preview' || (s.screen === 'printing' && s.printError)
        ? { ...s, screen: 'printing', printError: undefined } : s
    case 'printOk':
      return s.screen === 'printing' ? { ...s, screen: s.shareEnabled ? 'share' : 'thanks' } : s
    case 'done':
    case 'skip':
      return s.screen === 'share' ? { ...s, screen: 'thanks' } : s
    case 'printFail':
      // never lose the session: stay on printing screen with an error, retry or go back to preview
      return s.screen === 'printing' ? { ...s, printError: a.error } : s
    case 'timeout':
      // never time out mid-print (unless it failed and is waiting on a guest/staff)
      if (s.screen === 'idle') return s
      if (s.screen === 'printing' && !s.printError) return s
      return fresh(s)
    case 'reset':
      return fresh(s)
    default:
      return s
  }
}
