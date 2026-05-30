import { contextBridge, ipcRenderer } from 'electron'
import type { ChmDocument, TocNode, IndexEntry, SearchResult, IpcResult, MenuActionPayload } from '../shared/types'
import { IPC } from '../shared/types'

// Typed window.chm API exposed to the renderer.
// Only these methods cross the context boundary — no raw IPC in the renderer.

const chmApi = {
  openDialog: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.OPEN_DIALOG) as Promise<IpcResult<string | null>>,

  openChm: (filePath: string): Promise<IpcResult<ChmDocument>> =>
    ipcRenderer.invoke(IPC.OPEN_CHM, filePath) as Promise<IpcResult<ChmDocument>>,

  getToc: (chmId: string): Promise<IpcResult<TocNode[]>> =>
    ipcRenderer.invoke(IPC.GET_TOC, chmId) as Promise<IpcResult<TocNode[]>>,

  getIndex: (chmId: string): Promise<IpcResult<IndexEntry[]>> =>
    ipcRenderer.invoke(IPC.GET_INDEX, chmId) as Promise<IpcResult<IndexEntry[]>>,

  search: (chmId: string, query: string): Promise<IpcResult<SearchResult[]>> =>
    ipcRenderer.invoke(IPC.SEARCH, chmId, query) as Promise<IpcResult<SearchResult[]>>,

  // Subscribe to native menu commands (⌘O, ⌘[, ⌘], ⌘F, Open Recent).
  onMenuAction: (handler: (payload: MenuActionPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MenuActionPayload): void =>
      handler(payload)
    ipcRenderer.on(IPC.MENU_ACTION, listener)
    return () => ipcRenderer.removeListener(IPC.MENU_ACTION, listener)
  }
}

contextBridge.exposeInMainWorld('chm', chmApi)

// Window type is declared in src/renderer/env.d.ts for the renderer's tsconfig.
