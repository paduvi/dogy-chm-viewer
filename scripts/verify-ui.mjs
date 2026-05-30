// UI verification: launch the built app, verify empty state + CHM-open flow.
import { _electron as electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'tmp-shots')
mkdirSync(SHOTS, { recursive: true })

const ELECTRON_BIN = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const CHM = join(ROOT, process.env.CHM_REL || 'resources/esl_services_reference.chm')

async function shot(page, name) {
  const f = join(SHOTS, `${name}.png`)
  await page.screenshot({ path: f })
  console.log(`screenshot: ${f}`)
}

// Get the main app window (not the webview) — webview spawns extra webContents
// that Playwright might surface as a page.
function getMainPage(app) {
  // The main BrowserWindow has a file:// URL; the webview has chm:// or about:blank.
  const pages = app.windows()
  return pages.find(p => p.url().startsWith('file://')) ?? pages[0]
}

async function main() {
  console.log('Launching app...')
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [ROOT]
  })

  // Capture main-process stderr to detect ERR_ABORTED protocol errors.
  const mainErrors = []
  app.process().stderr?.on('data', (d) => {
    const s = d.toString()
    if (s.includes('ERR_ABORTED') || s.includes('GUEST_VIEW_MANAGER_CALL')) {
      mainErrors.push(s.trim())
    }
  })

  let page = await app.firstWindow()
  await page.waitForSelector('.toolbar', { timeout: 15000 })
  console.log('Window ready. URL:', page.url())

  // Capture renderer console and errors for diagnostics.
  page.on('console', m => { if (m.type() === 'error') console.log('RENDERER ERROR:', m.text()) })
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message))

  // ── Check 1: empty state ──────────────────────────────────────────────────
  await shot(page, '01-empty-state')
  const emptyText = await page.evaluate(() => document.querySelector('.content-empty')?.textContent?.trim() ?? '')
  console.log('Empty state text visible:', emptyText.includes('.chm'))

  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('.toolbar-btn')].map(b => b.textContent?.trim().slice(0, 10))
  )
  console.log('Toolbar buttons:', buttons)

  // ── Check 2: IPC chain ────────────────────────────────────────────────────
  // Verify the IPC handlers work end-to-end by calling directly from the renderer.
  const ipcResult = await page.evaluate(async (chmPath) => {
    const r = await window.chm.openChm(chmPath)
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, chmId: r.value.chmId, tocLen: r.value.toc.length, title: r.value.title }
  }, CHM)
  console.log('IPC openChm result:', JSON.stringify(ipcResult))
  console.assert(ipcResult.ok, 'openChm should succeed')
  console.assert(ipcResult.tocLen > 0, 'TOC should be non-empty')

  // ── Check 3: trigger UI open via mocked dialog ────────────────────────────
  // Mock the open-dialog IPC in the main process so clicking "Open" bypasses
  // the native file picker and immediately returns our sample CHM path.
  const mockOk = await app.evaluate(({ ipcMain }, chmPath) => {
    try {
      ipcMain.removeHandler('chm:open-dialog')
      ipcMain.handle('chm:open-dialog', () => ({ ok: true, value: chmPath }))
      return 'ok'
    } catch (e) { return String(e) }
  }, CHM)
  console.log('IPC mock:', mockOk)

  // Click the Open button to trigger the full React openChm flow.
  await page.click('.toolbar-btn:not(.nav-btn)')
  console.log('Clicked Open button — waiting for sidebar...')

  // Re-acquire the main page in case Playwright re-mapped it after webview load.
  // Poll for the sidebar up to 20 seconds.
  let sidePanelFound = false
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000))
    // Re-find the main app window each tick.
    const mainPage = getMainPage(app)
    if (!mainPage) { console.log('  tick', i, '— no windows'); continue }

    const state = await mainPage.evaluate(() => ({
      hasSide: !!document.querySelector('.side-panel'),
      hasToc:  !!document.querySelector('.toc-list'),
      hasError: !!document.querySelector('.error-banner'),
      errorText: document.querySelector('.error-banner')?.textContent?.trim() ?? null,
      loading: document.querySelector('.toolbar-btn')?.textContent?.includes('Opening') ?? false,
    }))
    console.log(`  tick ${i}:`, JSON.stringify(state))

    if (state.hasSide) {
      sidePanelFound = true
      page = mainPage  // update page reference
      break
    }
    if (state.hasError) {
      console.log('Error state appeared:', state.errorText)
      await shot(mainPage, '02-error')
      break
    }
  }

  if (!sidePanelFound) {
    // Take a final diagnostic screenshot of whatever is currently rendered.
    const mainPage = getMainPage(app)
    if (mainPage) await shot(mainPage, '02-timeout')
    throw new Error('Sidebar never appeared — see screenshot for current state')
  }

  await shot(page, '02-chm-loaded')
  const tocCount = await page.evaluate(() => document.querySelectorAll('.toc-row').length)
  console.log('TOC rows visible:', tocCount)

  // ── Check 4: navigate via TOC click ───────────────────────────────────────
  const firstTocRow = page.locator('.toc-row').first()
  await firstTocRow.click()
  console.log('Clicked first TOC entry')

  // Back button should become enabled after navigation.
  await page.waitForTimeout(2000)
  await shot(page, '03-after-toc-click')
  const backEnabled = await page.evaluate(() => {
    const navBtns = [...document.querySelectorAll('.nav-btn')]
    return !navBtns[0]?.disabled
  })
  console.log('Back button enabled after navigation:', backEnabled)

  // ── Check 5: Index tab ────────────────────────────────────────────────────
  const indexTab = page.locator('.side-tab', { hasText: 'Index' })
  if (await indexTab.count() > 0) {
    await indexTab.click()
    await page.waitForSelector('.index-list', { timeout: 3000 })
    const indexCount = await page.evaluate(() => document.querySelectorAll('.index-item').length)
    console.log('Index entries visible:', indexCount)
    await shot(page, '04-index-tab')
  } else {
    console.log('No Index tab (CHM has no .hhk)')
  }

  // ── Check 6: RAPID navigation stress (no delay → interleaved loads) ───────
  // Switch back to Contents and click many entries as fast as possible — this
  // is what reproduces ERR_ABORTED (a new load arriving before the prior one
  // finishes). With the single-load + catch fix there should be no errors.
  await page.locator('.side-tab', { hasText: 'Contents' }).click()
  await page.waitForTimeout(300)
  // Expand the first few nodes to surface plenty of clickable rows.
  const arrows = await page.locator('.toc-arrow:not(.toc-arrow--hidden)').count()
  for (let i = 0; i < Math.min(arrows, 5); i++) {
    await page.locator('.toc-row').nth(i).click().catch(() => {})
    await page.waitForTimeout(100)
  }
  const rows = await page.locator('.toc-row').count()
  console.log(`Rapid-clicking ${Math.min(rows, 20)} TOC rows with NO delay...`)
  for (let i = 1; i < Math.min(rows, 20); i++) {
    await page.locator('.toc-row').nth(i).click().catch(() => {})
    // No wait — deliberately interleave navigations.
  }
  await page.waitForTimeout(2500)
  await shot(page, '05-rapid-nav')

  // ── Report protocol errors ────────────────────────────────────────────────
  if (mainErrors.length > 0) {
    console.log(`\n❌ ${mainErrors.length} protocol error(s) detected:`)
    for (const e of mainErrors.slice(0, 5)) console.log('  ', e.split('\n')[0])
    await app.close()
    process.exit(1)
  }
  console.log('\n✅ No ERR_ABORTED / protocol errors')
  console.log('✅ Phase 4 UI verification complete')
  console.log(`Screenshots in: ${SHOTS}`)

  await app.close()
}

main().catch(async (e) => {
  console.error('❌', e.message)
  process.exit(1)
})
