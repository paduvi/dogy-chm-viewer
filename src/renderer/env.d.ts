import type { IpcResult, ChmDocument, TocNode, IndexEntry, SearchResult, MenuActionPayload } from '../shared/types'

declare global {
  interface Window {
    chm: {
      openDialog(): Promise<IpcResult<string | null>>
      openChm(filePath: string): Promise<IpcResult<ChmDocument>>
      getToc(chmId: string): Promise<IpcResult<TocNode[]>>
      getIndex(chmId: string): Promise<IpcResult<IndexEntry[]>>
      search(chmId: string, query: string): Promise<IpcResult<SearchResult[]>>
      onMenuAction(handler: (payload: MenuActionPayload) => void): () => void
    }
  }
}
