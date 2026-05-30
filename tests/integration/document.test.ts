import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChmFile } from '@core/chm/chm-file'
import { buildChmDocument, getToc, getIndex } from '@core/chm/document'
import { stripFragment } from '@core/chm/path-utils'
import type { TocNode } from '@shared/types'

const here = fileURLToPath(new URL('.', import.meta.url))
const RESOURCES = join(here, '..', '..', 'resources')
const chmFiles = readdirSync(RESOURCES).filter((f) => f.toLowerCase().endsWith('.chm'))

function flattenToc(nodes: TocNode[]): TocNode[] {
  return nodes.flatMap((n) => [n, ...flattenToc(n.children)])
}

function toInternal(local: string): string {
  const bare = stripFragment(local)
  return bare.startsWith('/') ? bare : '/' + bare
}

describe('ChmDocument (TOC + index) against real CHMs', () => {
  for (const chmName of chmFiles) {
    describe(chmName, () => {
      let chm: ChmFile

      beforeAll(() => {
        chm = new ChmFile()
        chm.open(new Uint8Array(readFileSync(join(RESOURCES, chmName))))
      })

      it('parses a non-empty, nested TOC', () => {
        const toc = getToc(chm)
        expect(toc.length).toBeGreaterThan(0)
        expect(toc.every((n) => n.name.length > 0)).toBe(true)
        // Real help TOCs have at least some nesting.
        expect(flattenToc(toc).length).toBeGreaterThan(toc.length)
      })

      it('every TOC link points to a real internal file', () => {
        const listed = new Set(chm.list().map((e) => e.path.toLowerCase()))
        const flat = flattenToc(getToc(chm))
        const missing = flat
          .filter((n) => n.localPath)
          .map((n) => toInternal(n.localPath as string))
          .filter((p) => !listed.has(p.toLowerCase()))
        expect(missing.slice(0, 15), `${missing.length} TOC links unresolved`).toEqual([])
      })

      it('builds a ChmDocument with a title derived from the filename', () => {
        const doc = buildChmDocument(chm, join(RESOURCES, chmName), 'test-id')
        expect(doc.chmId).toBe('test-id')
        expect(doc.title).toBe(chmName.replace(/\.chm$/i, ''))
        expect(doc.toc.length).toBeGreaterThan(0)
      })

      it('index entries (if any) carry a label and resolvable targets', () => {
        const index = getIndex(chm)
        if (index.length === 0) return // not all CHMs ship a .hhk
        const listed = new Set(chm.list().map((e) => e.path.toLowerCase()))
        for (const entry of index.slice(0, 200)) {
          expect(entry.name.length).toBeGreaterThan(0)
          for (const local of entry.localPaths) {
            expect(listed.has(toInternal(local).toLowerCase())).toBe(true)
          }
        }
      })
    })
  }
})
