/* Real Electron connection guard checks. No synthetic CAD session, no CAD writes. */
const { _electron: electron, expect } = require('@playwright/test')
const path = require('node:path')

async function requestWhenIdle(page, method, params = {}) {
  const deadline = Date.now() + 15000
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
  const app = await electron.launch(
    process.env.CADWEAVE_TEST_EXE
      ? { executablePath: process.env.CADWEAVE_TEST_EXE, args: [], env }
      : { args: [path.resolve(__dirname, '..')], env },
  )
  const errors = []
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText('SolidProps', { exact: false }).first()).toBeVisible()
    const discovered = await requestWhenIdle(page, 'discover')
    if (discovered.sessions?.some((session) => session.cadId === 'demo')) {
      throw Error('Synthetic CAD session discovered')
    }
    if (discovered.sessions?.some((session) => session.cadId !== 'solidworks')) {
      throw Error('Unexpected non-CAD session discovered')
    }
    if ((await page.getByRole('button', { name: /演示/ }).count()) > 0) throw Error('Demo action remains in UI')
    if ((await page.getByText('浏览器界面预览').count()) > 0) throw Error('Preview text remains in UI')

    // The connection page must reflect the same discovery result the bridge returned.
    const cards = page.getByTestId('session-select')
    if (discovered.sessions?.length) {
      await expect(cards).toHaveCount(discovered.sessions.length)
      await expect(page.getByTestId('connect-button').first()).toBeVisible()
    } else {
      await expect(cards).toHaveCount(0)
      await expect(page.getByRole('heading', { name: '尚未发现可连接会话', exact: true })).toBeVisible()
    }
    if (errors.length) throw Error(errors.join('\n'))
    console.log(
      'UI_INTERACTIONS_PASS',
      JSON.stringify({ realCadWrites: 0, sessions: discovered.sessions?.length ?? 0 }),
    )
  } finally {
    await app.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
