import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'
import { openSession, getSession, closeSession } from '../../src/main/chm-session'

// chm-session imports only Node + the pure core (no Electron), so it runs in
// Vitest directly. This guards the session/chmId lifecycle the chm:// protocol
// and renderer depend on.

const here = fileURLToPath(new URL('.', import.meta.url))
const RESOURCES = join(here, '..', '..', 'resources')
const CHM = join(RESOURCES, readdirSync(RESOURCES).find((f) => f.endsWith('.chm')) ?? '')

describe('chm-session', () => {
  it('opens a session and returns a ChmDocument with a chmId + TOC', () => {
    const doc = openSession(CHM)
    expect(doc.chmId).toMatch(/[0-9a-f-]{36}/)
    expect(doc.filePath).toBe(CHM)
    expect(doc.title.length).toBeGreaterThan(0) // derived from filename, any CHM
    expect(doc.toc.length).toBeGreaterThan(0)
    closeSession(doc.chmId)
  })

  it('reuses the same session (chmId) when reopening the same file', () => {
    const a = openSession(CHM)
    const b = openSession(CHM)
    expect(b.chmId).toBe(a.chmId)
    closeSession(a.chmId)
  })

  it('getSession returns the live ChmFile + doc, and read() works through it', () => {
    const doc = openSession(CHM)
    const session = getSession(doc.chmId)
    expect(session).not.toBeNull()
    expect(session?.doc.chmId).toBe(doc.chmId)

    // The first TOC entry's page must be readable through the session backend.
    const first = doc.toc[0]?.localPath
    expect(first).toBeTruthy()
    const internal = (first as string).split('#')[0]
    const path = internal.startsWith('/') ? internal : '/' + internal
    const bytes = session!.chm.read(path)
    expect(bytes.length).toBeGreaterThan(0)
    closeSession(doc.chmId)
  })

  it('closeSession invalidates the chmId and a fresh open gets a new id', () => {
    const a = openSession(CHM)
    closeSession(a.chmId)
    expect(getSession(a.chmId)).toBeNull()

    const b = openSession(CHM)
    expect(b.chmId).not.toBe(a.chmId) // cache was cleared on close
    closeSession(b.chmId)
  })

  it('getSession returns null for an unknown id', () => {
    expect(getSession('does-not-exist')).toBeNull()
  })
})
