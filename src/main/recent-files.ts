import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RECENT_FILE = join(app.getPath('userData'), 'recent-files.json')
const MAX_RECENT = 10

export function loadRecentFiles(): string[] {
  try {
    return JSON.parse(readFileSync(RECENT_FILE, 'utf8')) as string[]
  } catch {
    return []
  }
}

export function addRecentFile(filePath: string): string[] {
  const list = loadRecentFiles().filter((f) => f !== filePath)
  list.unshift(filePath)
  const trimmed = list.slice(0, MAX_RECENT)
  try {
    writeFileSync(RECENT_FILE, JSON.stringify(trimmed))
  } catch {
    // Best-effort.
  }
  return trimmed
}
