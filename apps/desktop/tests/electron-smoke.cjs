const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.CADWEAVE_TEST_EXE;
  const app = await electron.launch(executablePath
    ? { executablePath, args: [], env }
    : { args: [path.resolve(__dirname, '..')], env });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.getByText('CadWeave', { exact: false }).first().waitFor();
    const discovered = await page.evaluate(() => window.cadweave.request('discover'));
    if (discovered.sessions?.some(s => s.cadId === 'demo')) throw Error('Synthetic CAD session must never be discovered');
    if (discovered.sessions?.some(s => s.cadId !== 'solidworks')) throw Error('Unexpected non-CAD session discovered');
    console.log('DISCOVERY', JSON.stringify(discovered));
    if (await page.getByRole('button', { name: /演示/ }).count()) throw Error('Demo action remains in connection page');
    if (await page.getByText('浏览器界面预览').count()) throw Error('Preview label remains in desktop app');
    const metrics = await page.evaluate(() => ({
      shell: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
      canvas: getComputedStyle(document.documentElement).backgroundColor,
      bodyOverflow: document.body.scrollWidth > innerWidth,
      editableCells: document.querySelectorAll('.property-table input:not([readonly])').length,
      bridge: Boolean(window.cadweave)
    }));
    if (metrics.shell !== 'rgb(237, 239, 244)' || metrics.bodyOverflow || !metrics.bridge) throw Error('Layout/theme mismatch ' + JSON.stringify(metrics));
    console.log('INTERACTION_AND_THEME_PASS', JSON.stringify(metrics));
    fs.mkdirSync(path.resolve(__dirname, '../../..', 'artifacts/screenshots'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../../..', 'artifacts/screenshots/workspace.png') });
    if (errors.length) throw Error(errors.join('\n'));
    console.log('ELECTRON_SMOKE_PASS', JSON.stringify({title: await page.title(), screenshot:'artifacts/screenshots/workspace.png'}));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(1); });
