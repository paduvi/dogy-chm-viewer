import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { loadWindowState, trackWindowState } from './window-state'

export function createWindow(): BrowserWindow {
  const { x, y, width, height } = loadWindowState()
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      // Security — non-negotiable, per CLAUDE.md §2.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
      webSecurity: true,
      // Required for <webview> elements that display CHM content.
      webviewTag: true
    }
  })

  // Open http(s) links in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Prevent in-app navigation away from the app shell.
  win.webContents.on('will-navigate', (event, url) => {
    const appUrl = win.webContents.getURL()
    if (url !== appUrl) {
      event.preventDefault()
    }
  })

  win.on('ready-to-show', () => win.show())
  trackWindowState(win)

  return win
}
