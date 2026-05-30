import { ipcMain, BrowserWindow, type IpcMainEvent } from 'electron'
import type { IpcResult, ChmDocument, TocNode, IndexEntry, SearchResult } from '../shared/types'
import { IPC } from '../shared/types'
import { openSession, getSession, getSearchIndex } from './chm-session'
import { addRecentFile } from './recent-files'
import { buildMenu } from './menu'
import { pendingFiles, openFileInWindow, showOpenDialogAndOpen } from './index'

export function registerIpcHandlers(): void {

  // ── Renderer-mounted signal ────────────────────────────────────────────────
  // Renderer sends this (fire-and-forget) once its useEffect runs and the
  // onLoadFile listener is wired. Main then pushes the queued file path, if
  // any, knowing the listener is ready. This avoids the did-finish-load race
  // where LOAD_FILE arrives before React has subscribed to the channel.
  ipcMain.on(IPC.RENDERER_MOUNTED, (event: IpcMainEvent) => {
    const filePath = pendingFiles.get(event.sender.id)
    if (filePath) {
      pendingFiles.delete(event.sender.id)
      event.sender.send(IPC.LOAD_FILE, filePath)
    }
  })

  // ── Open in new / empty window ─────────────────────────────────────────────
  // Called by the renderer when the user drags a .chm or clicks the toolbar
  // "Open" button. filePath=null triggers the native Open dialog.
  ipcMain.handle(IPC.OPEN_IN_NEW_WINDOW, async (_event, filePath: unknown): Promise<void> => {
    if (typeof filePath === 'string') {
      openFileInWindow(filePath)
    } else {
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      await showOpenDialogAndOpen(win)
    }
  })

  // ── Legacy dialog (kept for backward-compat; now also triggered via menu) ──
  // No longer the primary open path — OPEN_IN_NEW_WINDOW replaces it for the
  // toolbar button. Kept so any existing call-sites don't break.
  ipcMain.handle(IPC.OPEN_DIALOG, async (): Promise<IpcResult<string | null>> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    await showOpenDialogAndOpen(win)
    return { ok: true, value: null }   // result is handled by the new window
  })

  // ── Open + parse CHM ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.OPEN_CHM, (event, filePath: unknown): IpcResult<ChmDocument> => {
    if (typeof filePath !== 'string') {
      return { ok: false, error: 'filePath must be a string' }
    }
    try {
      const doc = openSession(filePath)
      addRecentFile(filePath)

      // Set the window title to the CHM document title.
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        win.setTitle(doc.title || 'Dogy CHM Viewer')
        buildMenu(win, openFileInWindow)
      }

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
