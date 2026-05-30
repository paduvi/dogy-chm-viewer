import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MiniSearch from 'minisearch'
import { ChmFile } from '@core/chm/chm-file'

// Not part of the normal suite (tests/bench/** isn't in vitest include).
// Run explicitly: npx vitest run tests/bench/search.bench.ts
//
// Measures the real Phase 5 workload on the largest sample CHM: extract every
// HTML page, strip markup, build a MiniSearch index, query it.

const here = fileURLToPath(new URL('.', import.meta.url))
const RESOURCES = join(here, '..', '..', 'resources')
const decoder = new TextDecoder('windows-1252')

function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '', text }
}

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1) + ' MB'

describe('search benchmark', () => {
  it('FIS Profile Data Dictionary 7.5.chm', () => {
    const chmName = 'FIS Profile Data Dictionary 7.5.chm'
    const chm = new ChmFile()
    chm.open(new Uint8Array(readFileSync(join(RESOURCES, chmName))))

    const htmlPaths = chm.list().filter((e) => /\.html?$/i.test(e.path) && e.size > 0)

    // ── Extract + strip ──
    const t0 = performance.now()
    const docs: { id: string; title: string; text: string }[] = []
    let totalText = 0
    for (const entry of htmlPaths) {
      const raw = decoder.decode(chm.read(entry.path))
      const { title, text } = stripHtml(raw)
      totalText += text.length
      docs.push({ id: entry.path, title: title || entry.path, text })
    }
    const tExtract = performance.now() - t0

    // ── Build index ──
    const memBefore = process.memoryUsage().heapUsed
    const t1 = performance.now()
    const index = new MiniSearch({
      fields: ['title', 'text'],
      storeFields: ['title'],
      idField: 'id'
    })
    index.addAll(docs)
    const tBuild = performance.now() - t1
    const memAfter = process.memoryUsage().heapUsed

    // ── Serialize (for on-disk cache feasibility) ──
    const t2 = performance.now()
    const serialized = JSON.stringify(index)
    const tSerialize = performance.now() - t2

    // ── Query ──
    const queries = ['account', 'customer balance', 'transaction', 'teller', 'overview']
    const queryTimes: number[] = []
    let lastCount = 0
    for (const q of queries) {
      const t = performance.now()
      const results = index.search(q, { prefix: true, fuzzy: 0.2 })
      queryTimes.push(performance.now() - t)
      lastCount = results.length
    }
    const avgQuery = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length

    console.log(`\n=== Search benchmark: ${chmName} ===`)
    console.log(`HTML pages indexed:    ${docs.length}`)
    console.log(`Stripped text size:    ${mb(totalText)}`)
    console.log(`Extract + strip:       ${tExtract.toFixed(0)} ms`)
    console.log(`Index build:           ${tBuild.toFixed(0)} ms`)
    console.log(`Index heap footprint:  ~${mb(memAfter - memBefore)}`)
    console.log(`Serialize to JSON:     ${tSerialize.toFixed(0)} ms (${mb(serialized.length)} on disk)`)
    console.log(`Query (avg of ${queries.length}):     ${avgQuery.toFixed(2)} ms  (last query hits: ${lastCount})`)
    console.log(`Total cold open→searchable: ${(tExtract + tBuild).toFixed(0)} ms`)
  })
})
