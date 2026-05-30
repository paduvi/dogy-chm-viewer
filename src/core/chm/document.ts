/**
 * Assemble a ChmDocument (TOC + index) from an opened ChmBackend. Original code.
 *
 * Locates the .hhc / .hhk by extension (there is normally exactly one of each),
 * decodes and parses them. Keeps the parsing layer (hhc/hhk) pure and string-
 * based; this module is the thin bridge to the byte-level backend.
 */
import type { ChmBackend } from './backend'
import { parseHhc } from './hhc'
import { parseHhk } from './hhk'
import type { ChmDocument, TocNode, IndexEntry } from '../../shared/types'
import { basename } from './path-utils'

function findByExtension(backend: ChmBackend, ext: string): string | null {
  for (const entry of backend.list()) {
    if (entry.path.toLowerCase().endsWith(ext)) return entry.path
  }
  return null
}

/**
 * CHM sitemap files predate UTF-8; most are Windows-1252 (a superset of Latin-1
 * for printable bytes). We default to that and let any in-file entities decode
 * on top. Falls back to UTF-8 only if a charset hint says so.
 */
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(bytes)
}

export function getToc(backend: ChmBackend): TocNode[] {
  const path = findByExtension(backend, '.hhc')
  if (!path) return []
  return parseHhc(decodeText(backend.read(path)))
}

export function getIndex(backend: ChmBackend): IndexEntry[] {
  const path = findByExtension(backend, '.hhk')
  if (!path) return []
  return parseHhk(decodeText(backend.read(path)))
}

export function buildChmDocument(backend: ChmBackend, filePath: string, chmId: string): ChmDocument {
  return {
    chmId,
    filePath,
    title: basename(filePath).replace(/\.chm$/i, ''),
    toc: getToc(backend),
    index: getIndex(backend)
  }
}
