import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '../shared/types'
import type { MenuActionPayload } from '../shared/types'
import { loadRecentFiles } from './recent-files'

// Send a typed menu command to the focused renderer (back/forward/search).
function send(win: BrowserWindow | null, payload: MenuActionPayload): void {
  win?.webContents.send(IPC.MENU_ACTION, payload)
}

function buildRecentSubmenu(
  openFile: (filePath: string) => void
): MenuItemConstructorOptions[] {
  const recent = loadRecentFiles()
  if (recent.length === 0) {
    return [{ label: 'No Recent Files', enabled: false }]
  }
  return recent.map((filePath) => ({
    label: filePath.split('/').pop() ?? filePath,
    // Open in a new/empty window — handled entirely in main, no renderer IPC.
    click: () => openFile(filePath)
  }))
}

export function buildMenu(
  win: BrowserWindow | null,
  openFile: (filePath: string) => void,
  openDialog: (parentWin?: BrowserWindow) => Promise<void> = () => Promise.resolve()
): void {
  const template: MenuItemConstructorOptions[] = [
    // ── Application ──────────────────────────────────────────────────────────
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },

    // ── File ─────────────────────────────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          // Show the dialog in main and open the result in a new/empty window.
          click: () => { void openDialog(win ?? undefined) }
        },
        {
          label: 'Open Recent',
          submenu: buildRecentSubmenu(openFile)
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },

    // ── Edit ─────────────────────────────────────────────────────────────────
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },

    // ── View ─────────────────────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            if (!win) return
            win.webContents.zoomLevel = Math.min(win.webContents.zoomLevel + 0.5, 5)
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (!win) return
            win.webContents.zoomLevel = Math.max(win.webContents.zoomLevel - 0.5, -3)
          }
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            if (!win) return
            win.webContents.zoomLevel = 0
          }
        },
        { type: 'separator' },
        ...(process.env.NODE_ENV === 'development'
          ? ([
              { role: 'reload' as const },
              { role: 'forceReload' as const },
              { role: 'toggleDevTools' as const },
              { type: 'separator' as const }
            ])
          : []),
        { role: 'togglefullscreen' }
      ]
    },

    // ── Go ───────────────────────────────────────────────────────────────────
    {
      label: 'Go',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => send(win, { action: 'back' })
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => send(win, { action: 'forward' })
        },
        { type: 'separator' },
        {
          label: 'Search',
          accelerator: 'CmdOrCtrl+F',
          click: () => send(win, { action: 'search' })
        }
      ]
    },

    // ── Help ─────────────────────────────────────────────────────────────────
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: () => { void shell.openExternal('https://github.com') }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
