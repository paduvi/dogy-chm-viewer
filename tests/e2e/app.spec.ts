import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const ELECTRON_BIN =
  process.platform === 'darwin'
    ? join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : join(ROOT, 'node_modules/electron/dist/electron')
const CHM = join(ROOT, 'resources/PowerCollections.chm')

let app: ElectronApplication
let mainPage: Page
const protocolErrors: string[] = []

test.beforeAll(async () => {
  app = await electron.launch({ executablePath: ELECTRON_BIN, args: [ROOT] })
  app.process().stderr?.on('data', (d: Buffer) => {
    const s = d.toString()
    if (s.includes('ERR_ABORTED') || s.includes("handler for 'GUEST_VIEW_MANAGER_CALL'")) {
      protocolErrors.push(s.trim().split('\n')[0])
    }
  })
  mainPage = await app.firstWindow()
  await mainPage.waitForSelector('.toolbar', { timeout: 20_000 })
})

test.afterAll(async () => {
  await app?.close()
})

// Close any extra BrowserWindows from the main process so Playwright page
// objects for webviews are never touched (closing them reloads the parent
// renderer, which wipes the loaded CHM state and breaks subsequent tests).
test.afterEach(async () => {
  const mainId = await app.evaluate(({ BrowserWindow }) =>
    Math.min(...BrowserWindow.getAllWindows().map((w) => w.id))
  )
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()
      .filter((w) => w.id !== id)
      .forEach((w) => w.close())
  }, mainId)
  // Poll until only the main window remains (win.close() is async).
  await expect
    .poll(
      async () =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      { timeout: 5_000 }
    )
    .toBe(1)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

test('empty state shows on launch', async () => {
  await expect(mainPage.locator('.content-empty')).toBeVisible()
})

test('drag-and-drop: openInNewWindow IPC with a path opens CHM in the existing empty window', async () => {
  // The drop handler calls window.chm.getPathForFile(file) (bridges
  // webUtils.getPathForFile), then window.chm.openInNewWindow(filePath).
  // We simulate that IPC call directly — no OS drag event needed.
  await expect(mainPage.locator('.content-empty')).toBeVisible()

  // page.evaluate runs in the browser context; window.chm is injected by the
  // Electron preload. DOM types are not in tsconfig.test.json (Node context),
  // so we suppress the three unsafe-access rules for these evaluate calls.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await mainPage.evaluate((chmPath) => window.chm.openInNewWindow(chmPath), CHM)

  // Main sees the window is empty (not in loadedWindowIds) → pushes LOAD_FILE
  // → renderer's onLoadFile fires → openChmPath → .toc-list appears.
  await mainPage.waitForSelector('.toc-list', { timeout: 20_000 })
  const src = await mainPage.locator('webview').getAttribute('src')
  expect(src, 'webview must show a chm:// URL').toMatch(/^chm:\/\//)

  // No second window created — the existing empty window was reused.
  const winCount = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().length
  )
  expect(winCount, 'drag onto empty window must reuse it, not open a second').toBe(1)
})

test('each CHM opens in a new window when one is already loaded', async () => {
  // Precondition: mainPage has a CHM loaded.
  await mainPage.waitForSelector('.toc-list', { timeout: 10_000 })

  // Snapshot the current BrowserWindow IDs.
  const idsBefore = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.id)
  )

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await mainPage.evaluate((chmPath) => window.chm.openInNewWindow(chmPath), CHM)

  // Poll until a new BrowserWindow appears.
  let newWinId: number | undefined
  await expect
    .poll(
      async () => {
        const ids = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.id)
        )
        newWinId = ids.find((id) => !idsBefore.includes(id))
        return ids.length
      },
      { timeout: 10_000 }
    )
    .toBeGreaterThan(idsBefore.length)

  // Verify the new window loads the CHM by polling its title from the main
  // process. The title is set in ipc.ts after OPEN_CHM returns — this is the
  // most reliable indicator without depending on Playwright page detection
  // (app.windows() includes webview guest pages, making page identification brittle).
  await expect
    .poll(
      async () =>
        app.evaluate(({ BrowserWindow }, id) => {
          const win = BrowserWindow.getAllWindows().find((w) => w.id === id)
          return win?.getTitle() ?? ''
        }, newWinId!),
      { timeout: 30_000, message: 'new window title should become the CHM title' }
    )
    .toContain('PowerCollections')

  expect(newWinId, 'a new BrowserWindow must have been created').toBeDefined()
})

test('TOC navigation works', async () => {
  await mainPage.waitForSelector('.toc-list', { timeout: 10_000 })

  const initialSrc = await mainPage.locator('webview').getAttribute('src')
  await mainPage.waitForTimeout(1500)

  await mainPage.locator('.toc-row:not(.toc-row--active)').first().click()
  await expect
    .poll(async () => mainPage.locator('webview').getAttribute('src'), { timeout: 10_000 })
    .not.toBe(initialSrc)
  expect(await mainPage.locator('webview').getAttribute('src')).toMatch(/^chm:\/\//)
  await mainPage.waitForTimeout(1500)
})

test('index tab lists entries', async () => {
  await mainPage.waitForSelector('.toc-list', { timeout: 10_000 })

  await mainPage.locator('.side-tab', { hasText: 'Index' }).click()
  await mainPage.waitForSelector('.index-item', { timeout: 5_000 })
  expect(await mainPage.locator('.index-item').count()).toBeGreaterThan(0)
})

test('full-text search returns results and navigates', async () => {
  // .toc-list is only in the DOM when the Contents tab is active; use .side-tabs
  // as the CHM-loaded indicator (always present when doc is set).
  await mainPage.waitForSelector('.side-tabs', { timeout: 10_000 })

  await mainPage.locator('.side-tab', { hasText: 'Search' }).click()
  await mainPage.locator('.search-input').fill('collection')
  await mainPage.waitForSelector('.search-result', { timeout: 20_000 })
  expect(await mainPage.locator('.search-result').count()).toBeGreaterThan(0)

  const beforeSrc = await mainPage.locator('webview').getAttribute('src')
  await mainPage.locator('.search-result').first().click()
  await expect
    .poll(async () => mainPage.locator('webview').getAttribute('src'), { timeout: 10_000 })
    .not.toBe(beforeSrc)
  expect(await mainPage.locator('webview').getAttribute('src')).toMatch(/^chm:\/\//)
  await mainPage.waitForTimeout(1500)
})

test('no ERR_ABORTED or protocol errors during any navigation', () => {
  expect(protocolErrors, protocolErrors.join('\n')).toEqual([])
})
