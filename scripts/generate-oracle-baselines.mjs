// Oracle baseline generator (dev-only — never shipped).
//
// Extracts every internal file from each resources/*.chm using TWO independent
// mature references — 7-zip (7zz) and chmlib (extract_chmLib) — and records a
// per-file SHA-256. The two tools are cross-validated against each other on the
// files they both extract; any disagreement aborts. The result is committed to
// tests/fixtures/oracle-baselines.json and is the source of truth the pure-TS
// decoder is tested against (see tests/integration/oracle.test.ts).
//
// Usage: node scripts/generate-oracle-baselines.mjs
//
// Requires (macOS): `brew install sevenzip chmlib`

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RESOURCES = join(ROOT, 'resources')
const OUT = join(ROOT, 'tests', 'fixtures', 'oracle-baselines.json')

const SEVENZIP = '7zz'
const CHMLIB = 'extract_chmLib'

/** Walk a directory tree → Map<internalPath, { size, sha256 }>. */
function hashTree(dir) {
  const out = new Map()
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      const full = join(abs, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
      } else if (st.isFile()) {
        const rel = relative(dir, full).split(sep).join('/')
        const buf = readFileSync(full)
        out.set('/' + rel, { size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
      }
    }
  }
  walk(dir)
  return out
}

function extractWith7zip(chmPath, destDir) {
  execFileSync(SEVENZIP, ['x', chmPath, `-o${destDir}`, '-y'], { stdio: 'ignore' })
  return hashTree(destDir)
}

function extractWithChmlib(chmPath, destDir) {
  execFileSync(CHMLIB, [chmPath, destDir], { stdio: 'ignore' })
  return hashTree(destDir)
}

function listChmFiles() {
  return readdirSync(RESOURCES)
    .filter((f) => f.toLowerCase().endsWith('.chm'))
    .sort()
}

function main() {
  const chmFiles = listChmFiles()
  if (chmFiles.length === 0) throw new Error(`No .chm files in ${RESOURCES}`)

  const baseline = { generatedAt: new Date().toISOString(), tools: {}, files: {} }
  try {
    baseline.tools.sevenzip = execFileSync(SEVENZIP, ['i'], { encoding: 'utf8' }).split('\n')[1]?.trim() ?? 'unknown'
  } catch {
    baseline.tools.sevenzip = 'unknown'
  }

  let totalFiles = 0
  let totalMismatches = 0

  for (const chm of chmFiles) {
    const chmPath = join(RESOURCES, chm)
    const d7 = mkdtempSync(join(tmpdir(), 'oracle7z-'))
    const dc = mkdtempSync(join(tmpdir(), 'oraclechm-'))
    try {
      const by7zip = extractWith7zip(chmPath, d7)
      const byChmlib = extractWithChmlib(chmPath, dc)

      // Cross-validate: every file BOTH tools extracted must agree byte-for-byte.
      const mismatches = []
      for (const [path, chmEntry] of byChmlib) {
        const zEntry = by7zip.get(path)
        if (zEntry && zEntry.sha256 !== chmEntry.sha256) {
          mismatches.push(path)
        }
      }
      if (mismatches.length > 0) {
        totalMismatches += mismatches.length
        console.error(`✗ ${chm}: ${mismatches.length} cross-tool mismatch(es):`)
        for (const m of mismatches.slice(0, 10)) console.error(`    ${m}`)
        throw new Error(`Oracle tools disagree on ${chm} — cannot trust baseline`)
      }

      // 7-zip is the superset; record its checksums, tagging which tools confirmed each.
      const files = {}
      for (const [path, z] of by7zip) {
        const confirmedByChmlib = byChmlib.has(path)
        files[path] = {
          size: z.size,
          sha256: z.sha256,
          tools: confirmedByChmlib ? ['7zip', 'chmlib'] : ['7zip']
        }
      }
      // Anything chmlib has that 7zip somehow lacks (shouldn't happen, but be safe).
      for (const [path, c] of byChmlib) {
        if (!files[path]) files[path] = { size: c.size, sha256: c.sha256, tools: ['chmlib'] }
      }

      const count = Object.keys(files).length
      const bothCount = Object.values(files).filter((f) => f.tools.length === 2).length
      totalFiles += count
      baseline.files[chm] = files
      console.log(`✓ ${chm}: ${count} files (${bothCount} confirmed by both tools)`)
    } finally {
      rmSync(d7, { recursive: true, force: true })
      rmSync(dc, { recursive: true, force: true })
    }
  }

  if (totalMismatches > 0) throw new Error('Aborting: oracle tools disagreed')

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`\nWrote ${OUT}`)
  console.log(`${chmFiles.length} CHMs, ${totalFiles} total file checksums.`)
}

main()
