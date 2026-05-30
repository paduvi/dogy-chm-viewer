import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { IpcResult, ChmDocument, TocNode, IndexEntry, SearchResult } from '../shared/types'
import { IPC } from '../shared/types'
import { openSession, getSession, getSearchIndex } from './chm-session'
import { addRecentFile } from './recent-files'
import { buildMenu } from './menu'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.OPEN_DIALOG, async (): Promise<IpcResult<string | null>> => {
    const result = await dialog.showOpenDialog({
      title: 'Open CHM File',
      filters: [{ name: 'CHM Help Files', extensions: ['chm'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, value: null }
    }
    return { ok: true, value: result.filePaths[0] ?? null }
  })

  ipcMain.handle(IPC.OPEN_CHM, (_event, filePath: unknown): IpcResult<ChmDocument> => {
    if (typeof filePath !== 'string') {
      return { ok: false, error: 'filePath must be a string' }
    }
    try {
      const doc = openSession(filePath)
      addRecentFile(filePath)
      // Rebuild the menu so Open Recent reflects the latest file.
      const win = BrowserWindow.getFocusedWindow()
      buildMenu(win)
      return { ok: true, value: doc }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })

  ipcMain.handle(IPC.GET_TOC, (_event, chmId: unknown): IpcResult<TocNode[]> => {
    if (typeof chmId !== 'string') {
      return { ok: false, error: 'chmId must be a string' }
    }
    const session = getSession(chmId)
    if (!session) return { ok: false, error: `No session for chmId: ${chmId}` }
    return { ok: true, value: session.doc.toc }
  })

  ipcMain.handle(IPC.GET_INDEX, (_event, chmId: unknown): IpcResult<IndexEntry[]> => {
    if (typeof chmId !== 'string') {
      return { ok: false, error: 'chmId must be a string' }
    }
    const session = getSession(chmId)
    if (!session) return { ok: false, error: `No session for chmId: ${chmId}` }
    return { ok: true, value: session.doc.index }
  })

  ipcMain.handle(IPC.SEARCH, async (_event, chmId: unknown, query: unknown): Promise<IpcResult<SearchResult[]>> => {
    if (typeof chmId !== 'string' || typeof query !== 'string') {
      return { ok: false, error: 'chmId and query must be strings' }
    }
    const indexPromise = getSearchIndex(chmId)
    if (!indexPromise) return { ok: false, error: `No session for chmId: ${chmId}` }
    try {
      const index = await indexPromise
      return { ok: true, value: index.search(query) }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })
}
