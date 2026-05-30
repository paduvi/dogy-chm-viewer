// Shared types used across main, preload, and renderer processes.

export interface TocNode {
  id: string
  name: string
  localPath: string | null
  children: TocNode[]
}

export interface IndexEntry {
  id: string
  name: string
  localPaths: string[]
  /** nesting depth for indented sub-keywords (0 = top level) */
  depth: number
}

export interface SearchResult {
  id: string
  title: string
  localPath: string
  score: number
  excerpt: string
}

export interface ChmDocument {
  /** stable session identifier used to construct chm://<chmId>/... URLs */
  chmId: string
  filePath: string
  title: string
  toc: TocNode[]
  index: IndexEntry[]
}

// IPC channel names — single source of truth shared by main and preload.
export const IPC = {
  OPEN_CHM: 'chm:open',
  GET_TOC: 'chm:get-toc',
  GET_INDEX: 'chm:get-index',
  SEARCH: 'chm:search',
  READ_PAGE: 'chm:read-page',
  OPEN_DIALOG: 'chm:open-dialog',
  // Renderer signals main that it has mounted and wired up the onLoadFile listener.
  // Main responds by pushing LOAD_FILE if a file was queued for this window.
  RENDERER_MOUNTED: 'chm:renderer-mounted',
  // Main pushes a file path to a mounted renderer.
  LOAD_FILE: 'chm:load-file',
  // Renderer asks main to open a file (or show dialog) in a new/empty window.
  OPEN_IN_NEW_WINDOW: 'chm:open-in-new-window',
  // Main → renderer menu commands
  MENU_ACTION: 'menu:action'
} as const

// Commands the native menu can send to the renderer.
export type MenuAction = 'open' | 'back' | 'forward' | 'search' | 'open-recent'
export interface MenuOpenRecentPayload {
  action: 'open-recent'
  filePath: string
}
export type MenuActionPayload =
  | { action: Exclude<MenuAction, 'open-recent'> }
  | MenuOpenRecentPayload

// Typed IPC result wrapper — success or error, never throws across the boundary.
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }
