import type { BoothAPI, BackgroundScene, FrameOverlay, ImageData64, PrintLayout, VenueSettings } from '@shared/types'
import { CH } from './channels'
import type { Services } from './services'
import { toDataUrl } from './util'
import { log } from './logger'

type Handler = (...args: any[]) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pure channel -> handler map (no electron import) so it is unit-testable. */
export function buildHandlers(sv: Services): Record<string, Handler> {
  return {
    [CH.cameraList]: () => sv.cameras.list(),
    [CH.cameraConnect]: (id: string) => sv.cameras.connect(id),
    [CH.cameraCapture]: async () => toDataUrl(await sv.cameras.capture(), 'image/jpeg'),
    [CH.printerList]: () => sv.printQueue.listPrinters(),
    [CH.printerPrint]: (sessionId: string, copies: number) => sv.printQueue.enqueue(sessionId, copies),
    [CH.sessionStart]: () => sv.sessions.start(),
    [CH.sessionSaveShot]: (id: string, d: ImageData64) => sv.sessions.saveShot(id, d),
    [CH.sessionSaveComposite]: async (id: string, d: ImageData64) => {
      const s = await sv.sessions.saveComposite(id, d)
      await sv.share.onComposite(s).catch(e => log.error('share enqueue failed', e)) // never blocks printing
      return s
    },
    [CH.sessionGet]: (id: string) => sv.sessions.get(id),
    [CH.sessionList]: (limit?: number) => sv.sessions.list(limit),
    [CH.sessionUpdate]: (id: string, p: { sceneId?: string; frameId?: string; emailed?: string; test?: boolean }) => sv.sessions.patch(id, p ?? {}),
    [CH.sessionSaveKeyed]: (id: string, index: number, d: ImageData64) => sv.sessions.saveKeyed(id, index, d),
    [CH.libraryScenes]: () => sv.library.scenes(),
    [CH.librarySaveScene]: (s: BackgroundScene, img?: ImageData64) => sv.library.saveScene(s, img),
    [CH.libraryDeleteScene]: (id: string) => sv.library.deleteScene(id),
    [CH.libraryFrames]: () => sv.library.frames(),
    [CH.libraryLayouts]: () => sv.library.layouts(),
    [CH.libraryImageUrl]: (file: string) => sv.library.imageUrl(file),
    [CH.settingsGet]: () => sv.settings.get(),
    [CH.settingsSet]: (p: Partial<VenueSettings>) => sv.settings.set(p),
    [CH.statsSummary]: () => sv.sessions.stats(),
    [CH.aiCutout]: (d: ImageData64) => sv.cutout.cutout(d),
    [CH.librarySaveFrame]: (f: FrameOverlay, img?: ImageData64) => sv.library.saveFrame(f, img),
    [CH.librarySaveLayout]: (l: PrintLayout) => sv.library.saveLayout(l),
    [CH.shareEnabled]: () => sv.share.enabled(),
    [CH.shareReserve]: (sessionId: string) => sv.share.reserve(sessionId),
    [CH.shareEmail]: (shareId: string, email: string, consent: boolean, marketing: boolean) => sv.share.email(shareId, email, consent, marketing),
    [CH.shareStatus]: async () => sv.share.status()
  }
}

interface IpcMainLike { handle(ch: string, fn: (e: unknown, ...a: any[]) => unknown): void } // eslint-disable-line @typescript-eslint/no-explicit-any
interface WinLike { isDestroyed(): boolean; webContents: { send(ch: string, ...a: unknown[]): void } }

export function registerIpc(ipcMain: IpcMainLike, sv: Services, getWindow: () => WinLike | undefined): void {
  for (const [ch, fn] of Object.entries(buildHandlers(sv))) {
    ipcMain.handle(ch, async (_e, ...args) => {
      try { return await fn(...args) } catch (e) { log.error(`ipc ${ch} failed`, e); throw e }
    })
  }
  sv.printQueue.on('status', evt => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(CH.printerStatus, evt) })
}

export type { BoothAPI }
