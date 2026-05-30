// Reproduce the user's exact environment: the renderer running under the vite
// dev server (React DEVELOPMENT mode + StrictMode double-invoke + HMR), driven
// through the real UI. We start `electron-vite dev --rendererOnly` for the dev
// server, then launch Electron via Playwright pointed at it (ELECTRON_RENDERER_URL),
// which also gives us main-process access to mock the file dialog.
import { spawn, execSync } from 'node:child_process'
import { _electron as electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, 'tmp-shots')
mkdirSync(SHOTS, { recursive: true })
const ELECTRON_BIN = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const CHM = join(ROOT, process.env.CHM_REL || 'resources/esl_services_reference.chm')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // Build main + preload (renderer comes from the dev server).
  console.log('Building main/preload...')
  execSync('npx electron-vite build', { cwd: ROOT, stdio: 'ignore' })

  // Start the renderer dev server and capture its URL.
  console.log('Starting renderer dev server...')
  const dev = spawn('npx', ['electron-vite', 'dev', '--rendererOnly'], { cwd: ROOT })
  let devUrl = null
  const onData = (b) => {
    const s = b.toString()
    const m = s.match(/https?:\/\/localhost:\d+\/?/)
    if (m && !devUrl) devUrl = m[0]
  }
  dev.stdout.on('data', onData)
  dev.stderr.on('data', onData)

  for (let i = 0; i < 30 && !devUrl; i++) await sleep(500)
  if (!devUrl) throw new Error('dev server URL not detected')
  console.log('Dev server:', devUrl)
  await sleep(1500)

  console.log('Launching Electron against the dev renderer...')
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [ROOT],
    env: { ...process.env, ELECTRON_RENDERER_URL: devUrl }
  })

  const protoErrors = []
  app.process().stderr?.on('data', (d) => {
    const s = d.toString()
    if (s.includes('ERR_ABORTED') || s.includes('GUEST_VIEW_MANAGER_CALL')) {
      protoErrors.push(s.trim().split('\n')[0])
      process.stdout.write('  [main stderr] ' + s.trim().split('\n')[0] + '\n')
    }
  })

  const page = await app.firstWindow()
  await page.waitForSelector('.toolbar', { timeout: 20000 })
  console.log('App ready (dev renderer). URL:', page.url())

  // Mock the native dialog in the main process to return our sample CHM.
  await app.evaluate(({ ipcMain }, chmPath) => {
    ipcMain.removeHandler('chm:open-dialog')
    ipcMain.handle('chm:open-dialog', () => ({ ok: true, value: chmPath }))
  }, CHM)

  await page.click('.toolbar-btn:not(.nav-btn)')
  await page.waitForSelector('.toc-list', { timeout: 15000 })
  console.log('CHM loaded, TOC present.')
  await sleep(2000)

  // Verify the webview actually has a chm:// document loaded (the reported bug
  // was a permanently blank content view).
  const webviewSrc = await page.evaluate(() => {
    const wv = document.querySelector('webview')
    return wv ? wv.getAttribute('src') : null
  })
  console.log('Webview src after open:', webviewSrc)
  await page.screenshot({ path: join(SHOTS, 'dev-content-initial.png') })

  // Click a DIFFERENT leaf entry (not the initially-loaded page) and confirm
  // the webview navigates to a new chm:// page and renders fresh content.
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.toc-row')]
    // First leaf (no expand arrow) whose label isn't "Overview".
    const leaf = rows.find(
      (r) => !r.querySelector('.toc-arrow:not(.toc-arrow--hidden)') && !/overview/i.test(r.textContent || '')
    )
    leaf?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return leaf?.textContent?.trim() ?? null
  })
  console.log('Clicked DIFFERENT TOC entry:', target)
  await sleep(2000)
  const srcAfterClick = await page.evaluate(() => document.querySelector('webview')?.getAttribute('src') ?? null)
  console.log('Webview src after TOC click:', srcAfterClick)
  await page.screenshot({ path: join(SHOTS, 'dev-content-after-click.png') })
  if (!srcAfterClick || !srcAfterClick.startsWith('chm://')) {
    throw new Error('Content view did not load a chm:// page — STILL BLANK')
  }
  if (/Overview\/Overview\.htm$/.test(srcAfterClick)) {
    throw new Error('Webview did not navigate to a different page')
  }

  // Expand every top-level node to surface many leaf links.
  const arrowCount = await page.locator('.toc-arrow:not(.toc-arrow--hidden)').count()
  for (let i = 0; i < arrowCount; i++) {
    const arrow = page.locator('.toc-arrow:not(.toc-arrow--hidden)').nth(i)
    if (await arrow.count()) await arrow.click().catch(() => {})
    await sleep(80)
  }
  // Click LEAF rows (arrow hidden → no children → pure navigation, no toggling)
  // as fast as possible to maximise interleaved/superseded loads.
  const leaves = page.locator('.toc-row:has(.toc-arrow--hidden)')
  const leafCount = await leaves.count()
  const n = Math.min(leafCount, 40)
  console.log(`Rapid-clicking ${n} leaf rows TWICE (dev mode, no delay)...`)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      await leaves.nth(i).click().catch(() => {})
    }
  }
  await sleep(3000)
  await page.screenshot({ path: join(SHOTS, 'dev-rapid-nav.png') })

  if (protoErrors.length > 0) {
    console.log(`\n❌ ${protoErrors.length} protocol error(s) in dev mode`)
  } else {
    console.log('\n✅ No ERR_ABORTED in dev mode (renderer dev build + rapid nav)')
  }

  await app.close()
  dev.kill('SIGTERM')
  process.exit(protoErrors.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
