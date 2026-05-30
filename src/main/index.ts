import { app, BrowserWindow, nativeTheme } from 'electron'
import { createWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { registerChmScheme, installChmProtocolHandler } from './chm-protocol'
import { buildMenu } from './menu'
import { addRecentFile } from './recent-files'

// Must run before app is ready.
registerChmScheme()

// Harden against renderer-side prototype pollution / node injection.
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

// Expose addRecentFile so the IPC layer can call it when a CHM is opened.
export { addRecentFile }

void app.whenReady().then(() => {
  // Force a light theme for window chrome, scrollbars, and form controls.
  nativeTheme.themeSource = 'light'

  installChmProtocolHandler()
  registerIpcHandlers()

  const win = createWindow()
  buildMenu(win)
  loadShell(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      buildMenu(w)
      loadShell(w)
    }
  })
})

// macOS-only app — quit when the last window is closed (no dock-lingering).
app.on('window-all-closed', () => app.quit())

function loadShell(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile('out/renderer/index.html')
  }
}
