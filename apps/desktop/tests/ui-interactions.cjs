/* Real Electron connection/workspace guard checks. No synthetic CAD session or model data. */
const { _electron: electron, expect } = require('@playwright/test')
const path = require('node:path')

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
    const discovered = await page.evaluate(() => window.cadweave.request('discover'))
    if (discovered.sessions?.some((session) => session.cadId === 'demo')) {
      throw Error('Synthetic CAD session discovered')
    }
    if (discovered.sessions?.some((session) => session.cadId !== 'solidworks')) {
      throw Error('Unexpected non-CAD session discovered')
    }
    if ((await page.getByRole('button', { name: /演示/ }).count()) > 0) throw Error('Demo action remains in UI')
    if ((await page.getByText('浏览器界面预览').count()) > 0) throw Error('Preview text remains in UI')
    if (errors.length) throw Error(errors.join('\n'))
    console.log('UI_INTERACTIONS_PASS', JSON.stringify({ realCadWrites: 0, sessions: discovered.sessions?.length ?? 0 }))
  } finally {
    await app.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
