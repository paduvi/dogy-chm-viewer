import { app, screen, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface WindowState {
  x: number
  y: number
  width: number
  height: number
}

const STATE_FILE = join(app.getPath('userData'), 'window-state.json')
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800

export function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8')
    const state = JSON.parse(raw) as WindowState
    // Validate that the saved bounds are still on a connected display.
    const displays = screen.getAllDisplays()
    const visible = displays.some((d) => {
      const b = d.bounds
      return (
        state.x >= b.x &&
        state.y >= b.y &&
        state.x + state.width <= b.x + b.width &&
        state.y + state.height <= b.y + b.height
      )
    })
    if (visible && state.width > 400 && state.height > 300) return state
  } catch {
    // First launch or corrupted file — use defaults.
  }
  return { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
}

export function trackWindowState(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isMinimized() || win.isMaximized()) return
    const [x, y] = win.getPosition()
    const [width, height] = win.getSize()
    try {
      writeFileSync(STATE_FILE, JSON.stringify({ x, y, width, height }))
    } catch {
      // Non-fatal — best-effort persistence.
    }
  }

  win.on('resize', save)
  win.on('move', save)
  win.on('close', save)
}
