// Electron renderer build: the in-browser ai (onnxruntime-web + wasm + model) is NOT shipped, because the desktop app uses the
// main-process cutout (window.booth.ai). electron.vite.config.ts aliases '@webai/webCutout' to this stub.
export async function webCutout(_dataUrl: string): Promise<string> { throw new Error('in-browser ai is only part of the web demo build') }
export function webWarm(): void { /* nothing to warm */ }
