import type { IpcResult, ChmDocument, TocNode, IndexEntry, SearchResult, MenuActionPayload } from '../shared/types'

declare global {
  interface Window {
    chm: {
      /** Resolve a dropped File's real path (file.path is empty in sandbox mode). */
      getPathForFile(file: File): string
      /** Signal main that this renderer has mounted and is ready for LOAD_FILE. */
      rendererMounted(): void
      /** Subscribe to file-path pushes from main for already-mounted windows. */
      onLoadFile(handler: (filePath: string) => void): () => void
      /** Ask main to open filePath in a new/empty window. Omit to show dialog. */
      openInNewWindow(filePath?: string): Promise<void>
      openChm(filePath: string): Promise<IpcResult<ChmDocument>>
      getToc(chmId: string): Promise<IpcResult<TocNode[]>>
      getIndex(chmId: string): Promise<IpcResult<IndexEntry[]>>
      search(chmId: string, query: string): Promise<IpcResult<SearchResult[]>>
      onMenuAction(handler: (payload: MenuActionPayload) => void): () => void
    }
  }
}
