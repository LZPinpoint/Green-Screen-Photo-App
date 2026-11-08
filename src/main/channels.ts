// IPC channel names, shared by main (ipcMain.handle) and preload (ipcRenderer.invoke). Pattern: booth:<area>:<fn>
export const CH = {
  cameraList: 'booth:camera:list',
  cameraConnect: 'booth:camera:connect',
  cameraCapture: 'booth:camera:capture',
  printerList: 'booth:printer:list',
  printerPrint: 'booth:printer:print',
  printerStatus: 'booth:printer:status', // main -> renderer event (print job status)
  sessionStart: 'booth:session:start',
  sessionSaveShot: 'booth:session:saveShot',
  sessionSaveComposite: 'booth:session:saveComposite',
  sessionGet: 'booth:session:get',
  sessionList: 'booth:session:list',
  sessionUpdate: 'booth:session:update', // extra (not in BoothAPI): set sceneId/frameId/emailed
  sessionSaveKeyed: 'booth:session:saveKeyed', // extra: store keyed PNG for shot index
  libraryScenes: 'booth:library:scenes',
  librarySaveScene: 'booth:library:saveScene',
  libraryDeleteScene: 'booth:library:deleteScene',
  libraryFrames: 'booth:library:frames',
  libraryLayouts: 'booth:library:layouts',
  libraryImageUrl: 'booth:library:imageUrl',
  settingsGet: 'booth:settings:get',
  settingsSet: 'booth:settings:set',
  statsSummary: 'booth:stats:summary',
  aiCutout: 'booth:ai:cutout',
  librarySaveFrame: 'booth:library:saveFrame',
  librarySaveLayout: 'booth:library:saveLayout',
  shareEnabled: 'booth:share:enabled',
  shareReserve: 'booth:share:reserve',
  shareEmail: 'booth:share:email',
  shareStatus: 'booth:share:status'
} as const
