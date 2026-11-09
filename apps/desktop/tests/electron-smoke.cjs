/* Real Electron read-only system smoke: discovery, connect, snapshot, disconnect. Never writes CAD. */
const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

async function requestWhenIdle(page, method, params = {}) {
  const deadline = Date.now() + 20000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await page.evaluate(([m, p]) => window.cadweave.request(m, p), [method, params])
    } catch (error) {
      lastError = error
      if (!/CAD 操作进行中/.test(String(error.message))) throw error
      await page.waitForTimeout(150)
    }
  }
  throw lastError
}

;(async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const executablePath = process.env.CADWEAVE_TEST_EXE
  const app = await electron.launch(
    executablePath ? { executablePath, args: [], env } : { args: [path.resolve(__dirname, '..')], env },
  )
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText('SolidProps', { exact: false }).first()).toBeVisible()

    const discovered = await requestWhenIdle(page, 'discover')
    if (discovered.sessions?.some((session) => session.cadId === 'demo')) {
      throw Error('Synthetic CAD session must never be discovered')
    }
    if (discovered.sessions?.some((session) => session.cadId !== 'solidworks')) {
      throw Error('Unexpected non-CAD session discovered')
    }
    console.log('DISCOVERY', JSON.stringify(discovered))

    const connectable = (discovered.sessions ?? []).filter((session) => session.connectable)
    let snapshotTitle = null
    if (connectable.length) {
      await page.getByTestId('connect-button').first().click()
      await expect(page.getByRole('heading', { name: '文档属性', exact: true })).toBeVisible()
      const files = page.getByRole('list', { name: '模型文件', exact: true }).locator('li')
      await expect(files.first()).toBeVisible()
      const fileCount = await files.count()
      if (!fileCount) throw Error('Connected session returned an empty model list')
      await expect(page.getByRole('button', { name: '连接', exact: true })).toBeVisible()

      // Read-only snapshot view: no editable property inputs until the user enters edit mode.
      if ((await page.locator('.property-table input:not([readonly])').count()) > 0) {
        throw Error('Property table is editable before entering edit mode')
      }
      snapshotTitle = (await files.first().innerText()).split('\n')[0]
      console.log('SNAPSHOT', JSON.stringify({ fileCount, snapshotTitle }))
    } else {
      await expect(page.getByRole('heading', { name: '尚未发现可连接会话', exact: true })).toBeVisible()
    }

    const metrics = await page.evaluate(() => ({
      shell: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
      canvas: getComputedStyle(document.documentElement).backgroundColor,
      bodyOverflow: document.body.scrollWidth > innerWidth,
      bridge: Boolean(window.cadweave),
    }))
    if (metrics.shell !== 'rgb(237, 239, 244)' || metrics.bodyOverflow || !metrics.bridge) {
      throw Error('Layout/theme mismatch ' + JSON.stringify(metrics))
    }
    console.log('INTERACTION_AND_THEME_PASS', JSON.stringify(metrics))

    fs.mkdirSync(path.resolve(__dirname, '../../..', 'artifacts/screenshots'), { recursive: true })
    await page.screenshot({ path: path.resolve(__dirname, '../../..', 'artifacts/screenshots/workspace.png') })
    if (errors.length) throw Error(errors.join('\n'))
    console.log(
      'ELECTRON_SMOKE_PASS',
      JSON.stringify({ title: await page.title(), sessions: discovered.sessions?.length ?? 0, snapshotTitle }),
    )
  } finally {
    await app.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
