import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document } from 'flexsearch'
import { ChmFile } from '@core/chm/chm-file'

// FlexSearch counterpart to search.bench.ts — same CHM, same pipeline.
// Run: npx vitest run --config vitest.bench.config.ts

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

describe('search benchmark (FlexSearch)', () => {
  it('FIS Profile Data Dictionary 7.5.chm', () => {
    const chmName = 'FIS Profile Data Dictionary 7.5.chm'
    const chm = new ChmFile()
    chm.open(new Uint8Array(readFileSync(join(RESOURCES, chmName))))
    const htmlPaths = chm.list().filter((e) => /\.html?$/i.test(e.path) && e.size > 0)

    const t0 = performance.now()
    const docs: { id: string; title: string; text: string }[] = []
    for (const entry of htmlPaths) {
      const { title, text } = stripHtml(decoder.decode(chm.read(entry.path)))
      docs.push({ id: entry.path, title: title || entry.path, text })
    }
    const tExtract = performance.now() - t0

    const memBefore = process.memoryUsage().heapUsed
    const t1 = performance.now()
    const index = new Document<{ id: string; title: string; text: string }, ['title']>({
      document: { id: 'id', index: ['title', 'text'], store: ['title'] },
      tokenize: 'forward'
    })
    for (const doc of docs) index.add(doc)
    const tBuild = performance.now() - t1
    const memAfter = process.memoryUsage().heapUsed

    const queries = ['account', 'customer balance', 'transaction', 'teller', 'overview']
    const queryTimes: number[] = []
    let lastCount = 0
    for (const q of queries) {
      const t = performance.now()
      const results = index.search(q, { limit: 50 })
      queryTimes.push(performance.now() - t)
      const ids = new Set<unknown>()
      for (const field of results) for (const id of field.result) ids.add(id)
      lastCount = ids.size
    }
    const avgQuery = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length

    console.log(`\n=== FlexSearch benchmark: ${chmName} ===`)
    console.log(`HTML pages indexed:    ${docs.length}`)
    console.log(`Extract + strip:       ${tExtract.toFixed(0)} ms`)
    console.log(`Index build:           ${tBuild.toFixed(0)} ms`)
    console.log(`Index heap footprint:  ~${mb(memAfter - memBefore)}`)
    console.log(`Query (avg of ${queries.length}):     ${avgQuery.toFixed(2)} ms  (last query hits: ${lastCount})`)
    console.log(`Total cold open→searchable: ${(tExtract + tBuild).toFixed(0)} ms`)
  })
})
