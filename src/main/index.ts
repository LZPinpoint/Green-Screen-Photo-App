import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron'
import { join } from 'node:path'
import { initLogger, log } from './logger'
import { createServices } from './services'
import { registerIpc } from './ipc'
import { ElectronPrinter, createElectronPrintHost } from './printer/electron'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const kioskFlag = process.argv.includes('--kiosk')
let win: BrowserWindow | undefined
let stopCleanup: (() => void) | undefined

initLogger(join(app.getPath('userData'), 'logs'))
process.on('uncaughtException', e => log.error('uncaughtException', e))
process.on('unhandledRejection', e => log.error('unhandledRejection', e))

if (!app.requestSingleInstanceLock()) { app.quit() } else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(start).catch(e => { log.error('startup failed', e); app.quit() })
  app.on('window-all-closed', () => { stopCleanup?.(); app.quit() })
}

async function start(): Promise<void> {
  // Media (webcam) permission for our own origin only.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  const resourcesDir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const printer = new ElectronPrinter(await createElectronPrintHost())
  const services = createServices({ dataDir: app.getPath('userData'), resourcesDir, realPrinter: printer })
  stopCleanup = () => { services.stopCleanup(); void services.share.stop() }
  await services.share.start().catch(e => log.error('share start failed', e))
  registerIpc(ipcMain, services, () => win)
  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
}

/** true only for this app's own display route (dev server or packaged file), never an arbitrary page */
export function isDisplayUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.hash !== '#/display') return false
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return true
    return u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html')
  } catch { return false }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 800, show: false, backgroundColor: '#000000', title: 'imagine booth',
    kiosk: kioskFlag, fullscreen: kioskFlag, autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      devTools: isDev, spellcheck: false, backgroundThrottling: false
    }
  })
  const wc = win.webContents
  wc.setVisualZoomLevelLimits(1, 1) // no pinch zoom
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = undefined })

  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') { e.preventDefault(); if (win && !kioskFlag) win.setFullScreen(!win.isFullScreen()) ; return }
    if (isDev) return
    const k = input.key.toLowerCase()
    const devtools = input.key === 'F12' || ((input.control || input.meta) && input.shift && (k === 'i' || k === 'j' || k === 'c'))
    const reload = (input.control || input.meta) && (k === 'r' || k === 'w') || input.key === 'F5'
    const zoom = (input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)
    if (devtools || reload || zoom) e.preventDefault()
  })
  if (!isDev) {
    wc.on('devtools-opened', () => wc.closeDevTools())
    wc.on('will-navigate', e => e.preventDefault())
    wc.on('context-menu', e => e.preventDefault())
  }
  wc.setWindowOpenHandler(({ url }) => {
    // Staff console -> guest-facing second screen: only our own '#/display' route, fullscreen on an external monitor if present.
    if (isDisplayUrl(url)) {
      const ext = screen.getAllDisplays().find(d => d.id !== screen.getDisplayMatching(win!.getBounds()).id)
      const b = (ext ?? screen.getPrimaryDisplay()).bounds
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          x: b.x, y: b.y, width: ext ? b.width : 960, height: ext ? b.height : 540, fullscreen: !!ext,
          autoHideMenuBar: true, backgroundColor: '#000000', title: 'imagine booth — guest display',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: isDev }
        }
      }
    }
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('render-process-gone', (_e, d) => { log.error('renderer gone', d); if (d.reason !== 'clean-exit') wc.reload() })

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}
