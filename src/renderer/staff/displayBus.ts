// Operator window -> guest-facing display (second screen / projector) over BroadcastChannel('imagine-display').
// Frames are small ImageBitmaps (~15 fps) plus tiny events. Works across windows of the same origin, in Electron and in a plain browser.
export const DISPLAY_CHANNEL = 'imagine-display'
export const DISPLAY_FPS = 15
export const DISPLAY_FRAME_W = 540

export type DisplayMsg =
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'countdown'; n: number }          // 0 = hide
  | { type: 'flash' }
  | { type: 'scene'; name: string }
  | { type: 'next'; text: string }            // 'next please', '' to clear
  | { type: 'hello' }                         // display -> operator: i'm open, please send state + frames
  | { type: 'bye' }

const hasBC = () => typeof BroadcastChannel !== 'undefined'

/** operator side. Frames are only produced while a display is listening (it says hello every 2s). */
export function createDisplayPublisher() {
  const ch = hasBC() ? new BroadcastChannel(DISPLAY_CHANNEL) : null
  let lastHello = 0
  let onHello: () => void = () => {}
  if (ch) ch.onmessage = e => { const m = e.data as DisplayMsg; if (m?.type === 'hello') { lastHello = Date.now(); onHello() } else if (m?.type === 'bye') lastHello = 0 }
  return {
    get listening() { return !!ch && Date.now() - lastHello < 5000 },
    set onHello(f: () => void) { onHello = f },
    send(m: DisplayMsg) { try { ch?.postMessage(m) } catch { /* bitmap detached or channel closed */ } },
    close() { try { ch?.close() } catch { /* noop */ } }
  }
}

/** display side */
export function createDisplayReceiver(on: (m: DisplayMsg) => void) {
  const ch = hasBC() ? new BroadcastChannel(DISPLAY_CHANNEL) : null
  if (ch) ch.onmessage = e => on(e.data as DisplayMsg)
  const hello = () => { try { ch?.postMessage({ type: 'hello' } satisfies DisplayMsg) } catch { /* noop */ } }
  hello()
  const t = window.setInterval(hello, 2000)
  const bye = () => { try { ch?.postMessage({ type: 'bye' } satisfies DisplayMsg) } catch { /* noop */ } }
  window.addEventListener('pagehide', bye)
  return { close() { window.clearInterval(t); window.removeEventListener('pagehide', bye); bye(); try { ch?.close() } catch { /* noop */ } } }
}
