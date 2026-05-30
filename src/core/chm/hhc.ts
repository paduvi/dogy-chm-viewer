/**
 * .hhc (table of contents) parser → TocNode tree. Original code (not chmlib).
 *
 * The .hhc is a sitemap (see sitemap.ts); each entry carries a Name (label) and
 * usually one Local (the internal page to load, possibly with a #fragment).
 */
import type { TocNode } from '../../shared/types'
import { parseSitemap, type SitemapNode } from './sitemap'

export function parseHhc(content: string): TocNode[] {
  let counter = 0
  const convert = (nodes: SitemapNode[]): TocNode[] =>
    nodes.map((n) => ({
      id: `toc-${counter++}`,
      name: n.name,
      localPath: n.locals[0] ?? null,
      children: convert(n.children)
    }))
  return convert(parseSitemap(content))
}
