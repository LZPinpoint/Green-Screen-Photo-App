import { useEffect, useRef, useState } from 'react'
import { createSyntheticCamera, type SyntheticCamera } from './syntheticCamera'

export interface CameraState { stream: MediaStream | null; synthetic: boolean }

/** Opens the webcam while `active` (getUserMedia); falls back to a drawn green-screen person when unavailable. */
export function useCamera(active: boolean, deviceId?: string): CameraState {
  const [state, setState] = useState<CameraState>({ stream: null, synthetic: false })
  const live = useRef<{ stream?: MediaStream; synth?: SyntheticCamera }>({})

  useEffect(() => {
    if (!active) return
    let dead = false
    ;(async () => {
      let stream: MediaStream | null = null
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { ...(deviceId ? { deviceId: { ideal: deviceId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
          })
        }
      } catch { stream = null }
      if (dead) { stream?.getTracks().forEach(t => t.stop()); return }
      if (stream) { live.current.stream = stream; setState({ stream, synthetic: false }) }
      else { const synth = createSyntheticCamera(); live.current.synth = synth; setState({ stream: synth.stream, synthetic: true }) }
    })()
    return () => {
      dead = true
      live.current.stream?.getTracks().forEach(t => t.stop())
      live.current.synth?.stop()
      live.current = {}
      setState({ stream: null, synthetic: false })
    }
  }, [active, deviceId])

  return state
}
