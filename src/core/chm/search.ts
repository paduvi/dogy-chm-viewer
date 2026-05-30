/**
 * Full-text search over a CHM's HTML pages. Original code (MIT/project license).
 *
 * Extracts every page through the backend, strips markup, and builds a
 * FlexSearch in-memory index. We keep our own per-page text map (rather than
 * FlexSearch's `store`) so we can build match excerpts without duplicating the
 * text inside the index. Pure of Electron/DOM — runs in Node and tests.
 */
import { Document } from 'flexsearch'
import type { ChmBackend } from './backend'
import type { SearchResult } from '../../shared/types'
import { basename } from './path-utils'

const decoder = new TextDecoder('windows-1252')

interface PageMeta {
  title: string
  text: string
}

export interface ChmSearchIndex {
  /** number of indexed pages */
  readonly size: number
  search(query: string, limit?: number): SearchResult[]
}

/** Strip HTML to plain text and pull out the <title>. Regex-based (no DOM). */
export function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''
  return { title, text }
}

/**
 * Build the search index for a CHM. Yields to the event loop periodically so a
 * large CHM (~1 s of work) doesn't starve IPC / the chm:// protocol handler.
 */
export async function buildSearchIndex(backend: ChmBackend): Promise<ChmSearchIndex> {
  const index = new Document({
    document: { id: 'id', index: ['title', 'text'] },
    tokenize: 'forward' // as-you-type prefix matching
  })
  const meta = new Map<string, PageMeta>()

  const pages = backend.list().filter((e) => /\.html?$/i.test(e.path) && e.size > 0)
  let processed = 0
  for (const page of pages) {
    let html: string
    try {
      html = decoder.decode(backend.read(page.path))
    } catch {
      continue // unreadable entry — skip rather than fail the whole index
    }
    const { title, text } = stripHtml(html)
    if (text.length === 0) continue
    const displayTitle = title || basename(page.path).replace(/\.html?$/i, '')
    index.add({ id: page.path, title: displayTitle, text })
    meta.set(page.path, { title: displayTitle, text })

    if (++processed % 50 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  return {
    size: meta.size,
    search(query: string, limit = 30): SearchResult[] {
      const q = query.trim()
      if (q.length < 2) return []

      const fieldResults = index.search(q, { limit })
      const seen = new Set<string>()
      const out: SearchResult[] = []

      for (const fieldResult of fieldResults) {
        for (const rawId of fieldResult.result) {
          const id = String(rawId)
          if (seen.has(id)) continue
          seen.add(id)
          const m = meta.get(id)
          if (!m) continue
          out.push({ id, title: m.title, localPath: id, score: 0, excerpt: makeExcerpt(m.text, q) })
          if (out.length >= limit) break
        }
        if (out.length >= limit) break
      }

      // FlexSearch returns most-relevant first; expose a descending 0..1 score.
      const n = out.length
      out.forEach((r, i) => {
        r.score = n === 0 ? 0 : (n - i) / n
      })
      return out
    }
  }
}

/** Build a ~160-char snippet centred on the first query term, with ellipses. */
function makeExcerpt(text: string, query: string, radius = 80): string {
  const firstTerm = query.split(/\s+/)[0]?.toLowerCase() ?? ''
  const pos = firstTerm ? text.toLowerCase().indexOf(firstTerm) : -1
  if (pos === -1) {
    const head = text.slice(0, radius * 2).trim()
    return head + (text.length > radius * 2 ? '…' : '')
  }
  const start = Math.max(0, pos - radius)
  const end = Math.min(text.length, pos + firstTerm.length + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}
