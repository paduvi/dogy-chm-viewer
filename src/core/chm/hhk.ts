/**
 * .hhk (keyword index) parser → flat IndexEntry list. Original code (not chmlib).
 *
 * Index keywords may target multiple pages (repeated Local params) and may nest
 * sub-keywords (nested <ul>). We flatten the tree depth-first into a list — each
 * entry keeps its label and all target pages; nesting depth is recorded so the
 * UI can indent sub-keywords.
 */
import type { IndexEntry } from '../../shared/types'
import { parseSitemap, type SitemapNode } from './sitemap'

export function parseHhk(content: string): IndexEntry[] {
  const entries: IndexEntry[] = []
  let counter = 0

  const walk = (nodes: SitemapNode[], depth: number): void => {
    for (const n of nodes) {
      // Skip structural nodes that carry neither a label nor a target.
      if (n.name !== '' || n.locals.length > 0) {
        entries.push({
          id: `idx-${counter++}`,
          name: n.name,
          localPaths: n.locals,
          depth
        })
      }
      if (n.children.length > 0) walk(n.children, depth + 1)
    }
  }

  walk(parseSitemap(content), 0)
  return entries
}
