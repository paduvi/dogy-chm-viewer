import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ChmFile } from '../core/chm/chm-file'
import { buildChmDocument } from '../core/chm/document'
import { buildSearchIndex, type ChmSearchIndex } from '../core/chm/search'
import type { ChmDocument } from '../shared/types'

interface Session {
  filePath: string
  chm: ChmFile
  doc: ChmDocument
  /** lazily built on first search; the in-flight promise is cached to dedupe */
  searchIndex?: Promise<ChmSearchIndex>
}

// Module-level singletons — one per app lifetime.
const byId = new Map<string, Session>()
const byPath = new Map<string, string>() // filePath → chmId

export function openSession(filePath: string): ChmDocument {
  // Return cached session for the same path so reopening is instant.
  const existing = byPath.get(filePath)
  if (existing) {
    const session = byId.get(existing)
    if (session) return session.doc
  }

  const buffer = readFileSync(filePath)
  const chm = new ChmFile()
  chm.open(new Uint8Array(buffer))

  const chmId = randomUUID()
  const doc = buildChmDocument(chm, filePath, chmId)

  byId.set(chmId, { filePath, chm, doc })
  byPath.set(filePath, chmId)

  return doc
}

export function getSession(chmId: string): { chm: ChmFile; doc: ChmDocument } | null {
  const session = byId.get(chmId)
  return session ? { chm: session.chm, doc: session.doc } : null
}

/**
 * Get the full-text index for a session, building it on first call (~1 s for a
 * large CHM) and caching the promise so concurrent queries share one build.
 */
export function getSearchIndex(chmId: string): Promise<ChmSearchIndex> | null {
  const session = byId.get(chmId)
  if (!session) return null
  if (!session.searchIndex) {
    session.searchIndex = buildSearchIndex(session.chm)
  }
  return session.searchIndex
}

export function closeSession(chmId: string): void {
  const session = byId.get(chmId)
  if (!session) return
  session.chm.close()
  byPath.delete(session.filePath)
  byId.delete(chmId)
}
