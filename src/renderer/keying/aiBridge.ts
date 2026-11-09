// Main-thread glue between the pure keying logic and window.booth.ai.cutout (Electron main process OR the web demo's in-browser model).
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { KeyParams } from '../../shared/types'
import { AI_TIMEOUT_MS, analyzeBackdrop, liveHint, type BackdropReport, type KeyEngines, type Px, type Stage } from './autoKey'

// ─── status the UIs can show ('getting ready…' the first time the web model loads, 'cutting you out…') ───
export type AiPhase = 'idle' | 'loading' | 'cutting'
let phase: AiPhase = 'idle'
let active = 0
const subs = new Set<() => void>()
export const aiStatus = {
  get: () => phase,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },
  /** used by the web engine while it downloads / compiles the model */
  setLoading(on: boolean) { if (on) set('loading'); else set(active > 0 ? 'cutting' : 'idle') },
  begin() { active++; if (phase !== 'loading') set('cutting') },
  end() { active = Math.max(0, active - 1); if (active === 0 && phase !== 'loading') set('idle') }
}
function set(p: AiPhase) { if (p !== phase) { phase = p; subs.forEach(f => f()) } }
export const useAiPhase = () => useSyncExternalStore(aiStatus.subscribe, aiStatus.get, aiStatus.get)
export const aiLabel = (p: AiPhase) => (p === 'loading' ? 'getting ready (first time only)…' : 'cutting you out…')

const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('ai result did not load')); i.src = src })
}

/** Px -> jpeg data url (what ai.cutout takes) */
export function pxToDataUrl(px: Px, q = 0.9): string {
  const c = canvasOf(px.width, px.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0)
  return c.toDataURL('image/jpeg', q)
}

/** Run window.booth.ai.cutout on a picture and return the same-size RGBA result. */
export async function boothCutoutPx(px: Px): Promise<Px> {
  if (!window.booth?.ai?.cutout) throw new Error('ai cutout is not available here')
  aiStatus.begin()
  try {
    const png = await window.booth.ai.cutout(pxToDataUrl(px))
    const img = await loadImg(png)
    const c = canvasOf(px.width, px.height)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, px.width, px.height)
    const d = ctx.getImageData(0, 0, px.width, px.height)
    return { data: d.data, width: d.width, height: d.height }
  } finally { aiStatus.end() }
}

/** a data url from the ai engine -> alpha only, resized to w x h (staff worker path) */
export const AI_TIMEOUT = AI_TIMEOUT_MS
/** first web-model load needs longer than a warm cutout */
export const aiTimeoutMs = () => (isWebDemo() ? 40000 : AI_TIMEOUT_MS)
export const isWebDemo = () => !!(window as unknown as { __BOOTH_MOCK__?: boolean }).__BOOTH_MOCK__
export const aiAvailable = () => typeof window !== 'undefined' && !!window.booth?.ai?.cutout

export function kioskEngines(): KeyEngines {
  return { ai: aiAvailable() ? boothCutoutPx : undefined, aiTimeoutMs: aiTimeoutMs() }
}

/** start loading the model early (web demo) so the first real cutout is not the slow one */
export function warmUpAi() { try { (window.booth as unknown as { ai: { warm?: () => void } }).ai.warm?.() } catch { /* optional */ } }

// ─── live backdrop watch: ~2x per second, on a tiny frame, never per video frame ───
export interface LiveBackdrop { report?: BackdropReport; hint: string; stage?: Stage; noGreen: boolean }

export function useBackdropWatch(video: React.RefObject<HTMLVideoElement>, on: boolean, key: KeyParams, intervalMs = 500): LiveBackdrop {
  const [state, setState] = useState<LiveBackdrop>({ hint: '', noGreen: false })
  const keyRef = { current: key }; keyRef.current = key
  useEffect(() => {
    if (!on) { setState({ hint: '', noGreen: false }); return }
    let dead = false
    const c = document.createElement('canvas')
    let streak = 0, last = ''
    const tick = () => {
      const v = video.current
      if (dead || !v || !v.videoWidth || v.readyState < 2) return
      const k = 200 / Math.max(v.videoWidth, v.videoHeight)
      c.width = Math.max(8, Math.round(v.videoWidth * k)); c.height = Math.max(8, Math.round(v.videoHeight * k))
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(v, 0, 0, c.width, c.height)
      const d = ctx.getImageData(0, 0, c.width, c.height)
      const p = keyRef.current
      let report: BackdropReport
      try { report = analyzeBackdrop(d, p) } catch { return }
      const hint = liveHint(p.mode, report)
      // debounce: a hint must hold for 2 readings before it appears or changes (no flicker while someone walks in)
      if (hint === last) streak++; else { last = hint; streak = 1 }
      if (streak < 2) return
      const noGreen = p.mode !== 'chroma' && report.greenBorderFrac < 0.15
      setState(s => (s.hint === hint && s.noGreen === noGreen && sameStage(s.stage, report.stage)) ? s : { report, hint, stage: p.mode === 'auto' && !p.stage ? report.stage : undefined, noGreen })
    }
    const t = window.setInterval(tick, intervalMs)
    return () => { dead = true; window.clearInterval(t) }
  }, [on, video, intervalMs])
  return state
}
const sameStage = (a?: Stage, b?: Stage) => (!a && !b) || (!!a && !!b && ['left', 'right', 'top', 'bottom'].every(k => Math.abs(a[k as keyof Stage] - b[k as keyof Stage]) < 0.02))
