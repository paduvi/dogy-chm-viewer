import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChmFile } from '@core/chm/chm-file'
import { buildSearchIndex, stripHtml, type ChmSearchIndex } from '@core/chm/search'

const here = fileURLToPath(new URL('.', import.meta.url))
const RESOURCES = join(here, '..', '..', 'resources')
const CHM = join(RESOURCES, readdirSync(RESOURCES).find((f) => f.endsWith('.chm')) ?? '')

describe('stripHtml', () => {
  it('extracts the title and strips tags/entities', () => {
    const { title, text } = stripHtml(
      '<html><head><title>My Page</title></head><body><h1>Hello</h1>' +
        '<script>ignored()</script><p>World &amp; more</p></body></html>'
    )
    expect(title).toBe('My Page')
    expect(text).toContain('Hello')
    expect(text).toContain('World')
    expect(text).not.toContain('ignored')
    expect(text).not.toContain('<')
  })
})

describe('buildSearchIndex (real CHM)', () => {
  let chm: ChmFile
  let index: ChmSearchIndex

  beforeAll(async () => {
    chm = new ChmFile()
    chm.open(new Uint8Array(readFileSync(CHM)))
    index = await buildSearchIndex(chm)
  })

  it('indexes a substantial number of pages', () => {
    expect(index.size).toBeGreaterThan(100)
  })

  it('returns ranked results for a common term, with excerpts and resolvable pages', () => {
    const listed = new Set(chm.list().map((e) => e.path.toLowerCase()))
    // Use a term guaranteed to appear in any API/technical CHM.
    const results = index.search('class')
    expect(results.length).toBeGreaterThan(0)

    for (const r of results) {
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.excerpt.length).toBeGreaterThan(0)
      // Every result must point to a real internal page.
      expect(listed.has(r.localPath.toLowerCase())).toBe(true)
    }
    // Scores are descending in [0,1].
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('supports prefix (as-you-type) matching', () => {
    // "collect" should match pages containing "collection(s)" in any technical CHM.
    const results = index.search('collect')
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns nothing for too-short or absent queries', () => {
    expect(index.search('a')).toEqual([])
    expect(index.search('   ')).toEqual([])
    expect(index.search('zzqxnonexistentterm')).toEqual([])
  })

  it('respects the result limit', () => {
    const results = index.search('the', 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })
})
