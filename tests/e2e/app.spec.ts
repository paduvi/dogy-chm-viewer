import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'

// End-to-end regression guard for the two bugs that bit us during Phase 4:
//   1. Content view stayed blank (webview never loaded a page).
//   2. ERR_ABORTED spam from competing/duplicate loadURL calls.
// Launches the *built* app (run `electron-vite build` first — the test:e2e
// script does this) and drives the real UI.

const ROOT = join(__dirname, '..', '..')
const ELECTRON_BIN =
  process.platform === 'darwin'
    ? join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : join(ROOT, 'node_modules/electron/dist/electron')
const CHM = join(ROOT, 'resources/esl_services_reference.chm')

let app: ElectronApplication
const protocolErrors: string[] = []

test.beforeAll(async () => {
  app = await electron.launch({ executablePath: ELECTRON_BIN, args: [ROOT] })
  app.process().stderr?.on('data', (d: Buffer) => {
    const s = d.toString()
    if (s.includes('ERR_ABORTED') || s.includes("handler for 'GUEST_VIEW_MANAGER_CALL'")) {
      protocolErrors.push(s.trim().split('\n')[0])
    }
  })
})

test.afterAll(async () => {
  await app?.close()
})

test('opens a CHM, renders content, and navigates the TOC without protocol errors', async () => {
  const page = await app.firstWindow()
  await page.waitForSelector('.toolbar', { timeout: 20_000 })

  // Empty state until a file is opened.
  await expect(page.locator('.content-empty')).toBeVisible()

  // Mock the native open dialog (main process) to return our sample CHM.
  await app.evaluate(({ ipcMain }, chmPath) => {
    ipcMain.removeHandler('chm:open-dialog')
    ipcMain.handle('chm:open-dialog', () => ({ ok: true, value: chmPath }))
  }, CHM)

  // Open → the sidebar TOC and a webview should appear.
  await page.locator('.toolbar-btn:not(.nav-btn)').click()
  await page.waitForSelector('.toc-list', { timeout: 15_000 })

  // Bug #1 guard: the content view must actually load a chm:// page, not stay blank.
  const initialSrc = await page.locator('webview').getAttribute('src')
  expect(initialSrc, 'webview should load a chm:// page on open').toMatch(/^chm:\/\//)

  // Let the initial page finish loading before navigating again. We deliberately
  // navigate at a NORMAL (settled) pace: the double-load bug errored even on a
  // single settled navigation, whereas interrupting an in-flight load produces a
  // benign, expected ERR_ABORTED that no app can avoid.
  await page.waitForTimeout(1500)

  // Navigate to a different TOC entry and confirm the webview moves to a new page.
  await page.locator('.toc-row:not(.toc-row--active)').first().click()
  await expect
    .poll(async () => page.locator('webview').getAttribute('src'), { timeout: 10_000 })
    .not.toBe(initialSrc)
  const afterSrc = await page.locator('webview').getAttribute('src')
  expect(afterSrc).toMatch(/^chm:\/\//)
  await page.waitForTimeout(1500) // let this load settle too

  // Index tab should list keyword entries.
  await page.locator('.side-tab', { hasText: 'Index' }).click()
  await page.waitForSelector('.index-item', { timeout: 5_000 })
  expect(await page.locator('.index-item').count()).toBeGreaterThan(0)

  // Full-text search: type a query, wait for the index to build + results, then
  // click a result and confirm it navigates the content view.
  await page.locator('.side-tab', { hasText: 'Search' }).click()
  await page.locator('.search-input').fill('service')
  await page.waitForSelector('.search-result', { timeout: 20_000 }) // first query builds the index
  expect(await page.locator('.search-result').count()).toBeGreaterThan(0)

  const beforeSearchNav = await page.locator('webview').getAttribute('src')
  await page.locator('.search-result').first().click()
  await expect
    .poll(async () => page.locator('webview').getAttribute('src'), { timeout: 10_000 })
    .not.toBe(beforeSearchNav)
  expect(await page.locator('webview').getAttribute('src')).toMatch(/^chm:\/\//)
  await page.waitForTimeout(1500) // let it settle

  // Bug #2 guard: settled navigations (TOC + search-result) produce NO
  // ERR_ABORTED / GUEST_VIEW_MANAGER_CALL errors (the double-load regression).
  expect(protocolErrors, protocolErrors.join('\n')).toEqual([])
})
