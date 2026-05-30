import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { createWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { registerChmScheme, installChmProtocolHandler } from './chm-protocol'
import { buildMenu } from './menu'
import { addRecentFile } from './recent-files'
import { IPC } from '../shared/types'

// Must run before app is ready.
registerChmScheme()

// Harden against renderer-side prototype pollution / node injection.
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

// ── Multi-window file management ───────────────────────────────────────────────
//
// Each BrowserWindow renders exactly one CHM (or is "empty" waiting for a file).
// Main tracks:
//   loadedWindowIds  – window IDs that already have a CHM (or one queued).
//   pendingFiles     – webContentsId → filePath set before the shell finishes
//                      loading; renderer pulls it on mount via GET_PENDING_FILE.

const loadedWindowIds = new Set<number>()
const pendingFiles = new Map<number, string>()   // keyed by webContents.id

/** Expose for ipc.ts so GET_PENDING_FILE + OPEN_IN_NEW_WINDOW can be handled. */
export { loadedWindowIds, pendingFiles, openFileInWindow }
export { addRecentFile }

/**
 * Open `filePath` in an empty window if one exists, otherwise create a new one.
 *
 * Delivery is always via LOAD_FILE push. Timing differs by window state:
 *  - Existing empty window  → renderer already mounted; push immediately.
 *  - Brand-new window       → renderer not yet mounted; store in pendingFiles.
 *    When the renderer mounts it sends RENDERER_MOUNTED, main then pushes
 *    LOAD_FILE (handled in ipc.ts via ipcMain.on(RENDERER_MOUNTED, ...)).
 */
function openFileInWindow(filePath: string): void {
  const emptyWin = BrowserWindow.getAllWindows().find(
    (w) => !loadedWindowIds.has(w.id)
  )

  // Mark as loaded immediately so a rapid second call doesn't reuse the same
  // window for a different file.
  if (emptyWin) {
    loadedWindowIds.add(emptyWin.id)
    // Renderer already mounted — push directly; RENDERER_MOUNTED already fired.
    emptyWin.webContents.send(IPC.LOAD_FILE, filePath)
    buildMenu(emptyWin, openFileInWindow)
    emptyWin.focus()
  } else {
    const win = createWindow()
    loadShell(win)
    loadedWindowIds.add(win.id)
    // Store for the mount signal: renderer will send RENDERER_MOUNTED when its
    // useEffect runs and the onLoadFile listener is wired up.
    pendingFiles.set(win.webContents.id, filePath)
    buildMenu(win, openFileInWindow, showOpenDialogAndOpen)
    win.focus()
  }
}

/**
 * Show a native Open dialog in the main process and open the result in a
 * new/empty window.  Called by the toolbar "Open" button and ⌘O menu item.
 */
export async function showOpenDialogAndOpen(parentWin?: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(parentWin ?? (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]), {
    title: 'Open CHM File',
    filters: [{ name: 'CHM Help Files', extensions: ['chm'] }],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths[0]) {
    openFileInWindow(result.filePaths[0])
  }
}

// ── Finder / "open-file" ───────────────────────────────────────────────────────
// macOS fires this event when a .chm is double-clicked in Finder, passed via
// `open -a`, or dropped onto the Dock icon. It can fire BEFORE app is ready.

let pendingFinderFile: string | null = null

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    openFileInWindow(filePath)
  } else {
    pendingFinderFile = filePath
  }
})

// ── App lifecycle ──────────────────────────────────────────────────────────────

void app.whenReady().then(() => {
  // Force a light theme for window chrome, scrollbars, and form controls.
  nativeTheme.themeSource = 'light'

  installChmProtocolHandler()
  registerIpcHandlers()

  if (pendingFinderFile) {
    // A .chm was opened from Finder before the app finished starting.
    openFileInWindow(pendingFinderFile)
    pendingFinderFile = null
  } else {
    // Normal launch: open an empty window ready for the user to pick a file.
    const win = createWindow()
    buildMenu(win, openFileInWindow, showOpenDialogAndOpen)
    loadShell(win)
  }

  app.on('activate', () => {
    // Re-create a window on Dock click if all windows were closed.
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      buildMenu(w, openFileInWindow)
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
