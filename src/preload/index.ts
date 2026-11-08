import { contextBridge, ipcRenderer } from 'electron'
import type { BoothAPI, VenueSettings, BackgroundScene, ImageData64, Session } from '../shared/types'
import { CH } from '../main/channels'

export interface PrintJobEvent { jobId: string; sessionId: string; status: 'queued' | 'printing' | 'retrying' | 'done' | 'failed'; attempt: number; error?: string; copies: number }

/** BoothAPI plus a few optional extras the integrator may wire into the UI. */
export interface BoothAPIExt extends BoothAPI {
  session: BoothAPI['session'] & {
    update(id: string, patch: { sceneId?: string; frameId?: string; emailed?: string; test?: boolean; ticket?: number; label?: string }): Promise<Session>
    saveKeyed(id: string, index: number, dataUrl: ImageData64): Promise<Session>
  }
  printer: BoothAPI['printer'] & { onStatus(cb: (e: PrintJobEvent) => void): () => void }
}

const inv = <T>(ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a) as Promise<T>

const booth: BoothAPIExt = {
  camera: {
    list: () => inv(CH.cameraList),
    connect: id => inv(CH.cameraConnect, id),
    capture: () => inv(CH.cameraCapture)
  },
  printer: {
    list: () => inv(CH.printerList),
    print: (sessionId, copies) => inv(CH.printerPrint, sessionId, copies),
    onStatus: cb => {
      const fn = (_e: unknown, evt: PrintJobEvent) => cb(evt)
      ipcRenderer.on(CH.printerStatus, fn)
      return () => { ipcRenderer.removeListener(CH.printerStatus, fn) }
    }
  },
  session: {
    start: () => inv(CH.sessionStart),
    saveShot: (id, d) => inv(CH.sessionSaveShot, id, d),
    saveComposite: (id, d) => inv(CH.sessionSaveComposite, id, d),
    get: id => inv(CH.sessionGet, id),
    list: limit => inv(CH.sessionList, limit),
    update: (id, patch) => inv(CH.sessionUpdate, id, patch),
    saveKeyed: (id, i, d) => inv(CH.sessionSaveKeyed, id, i, d)
  },
  library: {
    scenes: () => inv(CH.libraryScenes),
    saveScene: (s: BackgroundScene, img?: ImageData64) => inv(CH.librarySaveScene, s, img),
    deleteScene: id => inv(CH.libraryDeleteScene, id),
    frames: () => inv(CH.libraryFrames),
    saveFrame: (f, img) => inv(CH.librarySaveFrame, f, img),
    layouts: () => inv(CH.libraryLayouts),
    saveLayout: l => inv(CH.librarySaveLayout, l),
    imageUrl: file => inv(CH.libraryImageUrl, file)
  },
  settings: {
    get: () => inv(CH.settingsGet),
    set: (s: Partial<VenueSettings>) => inv(CH.settingsSet, s)
  },
  stats: { summary: () => inv(CH.statsSummary) },
  ai: { cutout: d => inv(CH.aiCutout, d) },
  share: {
    enabled: () => inv(CH.shareEnabled),
    reserve: id => inv(CH.shareReserve, id),
    email: (shareId, email, consent, marketing) => inv(CH.shareEmail, shareId, email, consent, marketing),
    status: () => inv(CH.shareStatus)
  }
}

contextBridge.exposeInMainWorld('booth', booth)
