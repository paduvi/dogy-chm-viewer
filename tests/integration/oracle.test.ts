import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChmFile } from '@core/chm/chm-file'

// Oracle / differential correctness gate (CLAUDE.md §2.1).
//
// Asserts our pure-TS decoder extracts EVERY internal file of EVERY sample CHM
// byte-for-byte identically to the committed baselines, which were independently
// produced and cross-validated by 7-zip + chmlib
// (see scripts/generate-oracle-baselines.mjs). A single mismatched byte fails.

interface BaselineEntry {
  size: number
  sha256: string
  tools: string[]
}
interface Baselines {
  files: Record<string, Record<string, BaselineEntry>>
}

const here = fileURLToPath(new URL('.', import.meta.url))
const RESOURCES = join(here, '..', '..', 'resources')
const BASELINE_PATH = join(here, '..', 'fixtures', 'oracle-baselines.json')

const baselines = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baselines

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

describe('Oracle: byte-identical extraction vs chmlib + 7-zip', () => {
  for (const [chmName, files] of Object.entries(baselines.files)) {
    describe(chmName, () => {
      let chm: ChmFile
      const paths = Object.keys(files)

      beforeAll(() => {
        chm = new ChmFile()
        chm.open(new Uint8Array(readFileSync(join(RESOURCES, chmName))))
      })

      it(`extracts all ${paths.length} files byte-identically`, () => {
        const mismatches: string[] = []
        for (const path of paths) {
          const expected = files[path]
          let bytes: Uint8Array
          try {
            bytes = chm.read(path)
          } catch (err) {
            mismatches.push(`${path}: read threw — ${(err as Error).message}`)
            continue
          }
          if (bytes.length !== expected.size) {
            mismatches.push(`${path}: size ${bytes.length} ≠ expected ${expected.size}`)
          } else if (sha256(bytes) !== expected.sha256) {
            mismatches.push(`${path}: SHA-256 mismatch (size ${bytes.length} matches)`)
          }
        }
        // Show only the first few to keep failure output readable.
        expect(mismatches.slice(0, 15), `${mismatches.length} mismatch(es)`).toEqual([])
      })

      it('lists at least every baseline file', () => {
        const listed = new Set(chm.list().map((e) => e.path))
        const missing = paths.filter((p) => !listed.has(p))
        expect(missing.slice(0, 15), `${missing.length} missing from list()`).toEqual([])
      })
    })
  }
})
