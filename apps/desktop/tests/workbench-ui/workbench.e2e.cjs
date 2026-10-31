const { test: base, expect, _electron: electron } = require('@playwright/test')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const test = base.extend({
  harness: async ({}, use) => {
    const renderer = path.resolve(__dirname, '../../out/renderer/index.html')
    await fs.access(renderer).catch(() => { throw new Error('Build renderer first: pnpm --filter @cadweave/desktop build') })
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cadweave-workbench-ui-'))
    const env = { ...process.env, CADWEAVE_FIXTURE_USER_DATA: path.join(temporaryRoot, 'user-data') }
    delete env.ELECTRON_RUN_AS_NODE
    let app
    const errors = []
    try {
      app = await electron.launch({ args: [path.join(__dirname, 'fixture-main.cjs')], env })
      const page = await app.firstWindow()
      page.on('pageerror', error => errors.push(error.message))
      await page.waitForLoadState('domcontentloaded')
      await page.getByTestId('connect-button').click()
      await expect(page.getByRole('tab', { name: '文件', exact: true })).toHaveAttribute('aria-selected', 'true')
      const state = () => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__workbenchFixture)))
      await use({ app, page, state, temporaryRoot })
      expect(errors, 'renderer uncaught errors').toEqual([])
    } finally {
      // Unsaved draft beforeunload must not hang teardown.
      if (app) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {})
        await app.close()
      }
      // Only remove the exact mkdtemp root verified above, never real application data.
      if (temporaryRoot.startsWith(path.join(os.tmpdir(), 'cadweave-workbench-ui-'))) {
        await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5 })
      }
    }
  },
})
const fileCheckbox = (page, name) => page.getByRole('checkbox', { name: new RegExp(`^选择文件 ${name.replaceAll('.', '\\.')}`) })
const row = (page, name) => page.locator('tbody tr').filter({ has: page.locator('.property-name-cell', { hasText: new RegExp(`^${name}$`) }) })
async function selectAllAndEdit(page) {
  await page.getByRole('checkbox', { name: '全选当前可见文件' }).check()
  await page.getByTestId('edit-properties').click()
}

test('connect → unique file view; viewing is read-only; queries preserve batch selection', async ({ harness }) => {
  const { page, state, app, temporaryRoot } = harness
  await expect(page.getByRole('list', { name: '模型文件', exact: true }).locator('li')).toHaveCount(3)
  await expect(page.getByLabel('装配引用 2 次', { exact: true })).toHaveCount(1)
  await expect(page.locator('.matrix, .matrix-panel, .result-panel, .results-panel')).toHaveCount(0)
  await expect(page.getByTestId('submit-changes')).toBeDisabled()
  await page.getByRole('button', { name: /^仅选择文件 FixtureAssembly/ }).click()
  await expect(page.getByRole('textbox', { name: '属性值 Material', exact: true })).toHaveAttribute('readonly', '')
  await expect(page.getByRole('button', { name: '修改属性', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '新增属性', exact: true })).toBeDisabled()
  await fileCheckbox(page, 'PartA.SLDPRT').check()
  await expect(page.getByRole('heading', { name: '已选 2 个文件', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '批量编辑', exact: true })).toBeDisabled()
  await page.getByTestId('edit-properties').click()
  await expect(page.getByRole('button', { name: '批量编辑', exact: true })).toBeEnabled()
  await page.getByRole('searchbox', { name: '搜索文件名或路径' }).fill('PartB')
  await expect(page.getByText('搜索隐藏了 2 个已选文件', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已选 2 个文件', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索文件名或路径' }).clear()
  await expect(fileCheckbox(page, 'FixtureAssembly.SLDASM')).toBeChecked()
  await expect(fileCheckbox(page, 'PartA.SLDPRT')).toBeChecked()
  await expect(fileCheckbox(page, 'PartB.SLDPRT')).not.toBeChecked()
  await page.getByRole('textbox', { name: '查询属性', exact: true }).fill('no-match')
  await expect(page.getByText('没有符合查询条件的属性。', { exact: true })).toBeVisible()
  await expect(fileCheckbox(page, 'PartA.SLDPRT')).toBeChecked()
  await page.getByRole('textbox', { name: '查询属性', exact: true }).clear()
  await expect(row(page, 'Material').getByRole('button', { name: 'Steel', exact: true })).toBeVisible()
  await expect(row(page, 'Description').getByRole('button', { name: '多个不同值', exact: true })).toBeVisible()
  const captured = await state()
  expect(captured.applies).toEqual([])
  expect(captured.calls.filter(call => call.channel === 'cad').map(call => call.method)).toEqual(['discover', 'connect', 'snapshot'])
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(temporaryRoot, 'user-data'))
})

test('missing defaults to skip; explicit fill adds; save gates submit and exact mocked apply payload', async ({ harness }, testInfo) => {
  const { page, state } = harness
  await selectAllAndEdit(page)
  const geometry = await page.evaluate(() => {
    const selectors = ['.file-sidebar', '.property-panel', '.property-toolbar', '.vertical-properties', '.app-status']
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      boxes: selectors.map(selector => {
        const element = document.querySelector(selector)
        if (!element) throw new Error(`Missing layout element: ${selector}`)
        const rect = element.getBoundingClientRect()
        return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
      }),
    }
  })
  expect(geometry.documentWidth, 'no document horizontal overflow').toBeLessThanOrEqual(geometry.viewportWidth)
  for (const box of geometry.boxes) {
    expect(box.width, `${box.selector} visible width`).toBeGreaterThan(0)
    expect(box.height, `${box.selector} visible height`).toBeGreaterThan(0)
    expect(box.left, `${box.selector} within left viewport`).toBeGreaterThanOrEqual(0)
    expect(box.right, `${box.selector} within right viewport`).toBeLessThanOrEqual(geometry.viewportWidth)
  }
  expect(geometry.boxes[0].right, 'sidebar does not overlap property panel').toBeLessThanOrEqual(geometry.boxes[1].left)
  const screenshotPath = testInfo.outputPath('workbench-multi-file.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  expect((await fs.stat(screenshotPath)).size).toBeGreaterThan(0)
  await expect(row(page, 'Code')).toContainText('2 / 3 个文件')
  await row(page, 'Code').getByRole('button', { name: '多个不同值', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量编辑属性', exact: true })
  await expect(dialog.getByRole('radio', { name: '仅修改已有属性（默认）', exact: true })).toBeChecked()
  await expect(dialog.getByRole('button', { name: '加入编辑', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox', { name: '批量属性值', exact: true }).fill('UNIFIED')
  await expect(dialog).toContainText('预计处理 2 项，跳过 1 项')
  await dialog.getByRole('button', { name: '加入编辑', exact: true }).click()
  await expect(row(page, 'Code')).toContainText('2 / 3 个文件')
  await expect(page.getByTestId('save-draft')).toContainText('2')
  expect((await state()).applies).toEqual([])
  await row(page, 'Code').getByRole('button', { name: 'UNIFIED', exact: true }).click()
  await expect(dialog.getByRole('radio', { name: '仅修改已有属性（默认）', exact: true })).toBeChecked()
  await dialog.getByRole('radio', { name: '修改已有属性，并为缺少的文件新增', exact: true }).check()
  // The two existing values are already staged; only the missing file is newly affected.
  await expect(dialog).toContainText('预计处理 1 项，跳过 2 项')
  await dialog.getByRole('button', { name: '加入编辑', exact: true }).click()
  await expect(row(page, 'Code')).toContainText('3 / 3 个文件')
  await expect(row(page, 'Code')).toContainText('待新增')
  await expect(page.getByTestId('submit-changes')).toHaveCount(0)
  expect((await state()).applies).toHaveLength(0)
  await page.getByTestId('save-draft').click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  let captured = await state()
  expect(captured.applies).toHaveLength(0)
  expect(captured.drafts.at(-1).entries).toHaveLength(3)
  await page.getByTestId('submit-changes').click()
  await expect(page.getByRole('dialog', { name: '提交属性修改', exact: true })).toContainText('3 个文件 · 3 项')
  expect((await state()).applies).toHaveLength(0)
  await page.getByTestId('apply-changes').click()
  await expect.poll(async () => (await state()).applies.length).toBe(1)
  captured = await state()
  expect(captured.applies[0]).toEqual({ snapshotId: 'mock-snapshot-1', confirmSave: true, changes: [
    { operation: 'update', modelId: 'root', propertyName: 'Code', oldValue: 'ROOT', newValue: 'UNIFIED' },
    { operation: 'update', modelId: 'part-a', propertyName: 'Code', oldValue: 'A', newValue: 'UNIFIED' },
    { operation: 'add', modelId: 'part-b', propertyName: 'Code', oldValue: '', newValue: 'UNIFIED' },
  ] })
  await expect(page.getByTestId('submit-changes')).toBeDisabled()
  await expect(page.locator('.matrix, .result-panel, .results-panel')).toHaveCount(0)
})

test('mixed values require explicit input or explicit clear; repeated occurrence highlights exactly one', async ({ harness }) => {
  const { page, state } = harness
  await selectAllAndEdit(page)
  await row(page, 'Description').getByRole('button', { name: '多个不同值', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量编辑属性', exact: true })
  await expect(dialog.getByRole('textbox', { name: '批量属性值', exact: true })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: '加入编辑', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '明确清空属性值', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '加入编辑', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '加入编辑', exact: true }).click()
  await expect(row(page, 'Description').getByRole('button', { name: '（空）', exact: true })).toBeVisible()
  await page.getByTestId('save-draft').click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  expect((await state()).drafts.at(-1).entries.every(entry => entry.newValue === '')).toBe(true)
  await page.getByRole('tab', { name: '装配结构', exact: true }).click()
  await page.getByRole('button', { name: 'PartA-2', exact: true }).click()
  await expect(page.getByRole('treeitem', { name: 'PartA-2', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('treeitem', { name: 'PartA-1', exact: true })).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'PartA.SLDPRT', exact: true })).toBeVisible()
  await expect(page.getByText('所选文件被引用 2 次；各实例共享同一文件属性。', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '文件', exact: true }).click()
  await expect(fileCheckbox(page, 'PartA.SLDPRT')).toBeChecked()
  await expect(fileCheckbox(page, 'FixtureAssembly.SLDASM')).not.toBeChecked()
  await expect(fileCheckbox(page, 'PartB.SLDPRT')).not.toBeChecked()
  expect((await state()).applies).toEqual([])
})

test('bulk add skips existing; delete skips missing; cancel restores saved draft', async ({ harness }) => {
  const { page, state } = harness
  await selectAllAndEdit(page)
  await page.getByRole('button', { name: '新增属性', exact: true }).click()
  await page.getByRole('textbox', { name: '新增属性名称', exact: true }).fill('Code')
  await page.getByRole('textbox', { name: '新增属性值', exact: true }).fill('ONLY-MISSING')
  const add = page.locator('.inline-property-add')
  await expect(add).toContainText('预计新增 1 项，跳过 2 项')
  await add.getByRole('button', { name: '加入编辑', exact: true }).click()
  await expect(row(page, 'Code')).toContainText('3 / 3 个文件')
  await expect(page.getByTestId('save-draft')).toContainText('1')
  await page.getByTestId('save-draft').click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  const savedEntries = (await state()).drafts.at(-1).entries
  expect(savedEntries).toEqual([expect.objectContaining({ propertyName: 'Code', operation: 'add', oldValue: '', newValue: 'ONLY-MISSING', modelPath: expect.stringContaining('PartB.SLDPRT') })])

  // Deleting a property also withdraws an unsubmitted add rather than issuing a CAD delete for it.
  await page.getByTestId('edit-properties').click()
  await page.getByRole('checkbox', { name: '选择属性 Code', exact: true }).check()
  await page.getByRole('button', { name: '删除属性 (1)', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '删除属性', exact: true })
  await expect(dialog).toContainText('预计处理 3 项，跳过 0 项')
  await dialog.getByRole('button', { name: '加入编辑', exact: true }).click()
  await expect(row(page, 'Code')).toContainText('待删除')
  await expect(page.getByTestId('save-draft')).toContainText('2')
  await page.getByTestId('cancel-edit').click()
  await page.getByRole('dialog', { name: '取消本次编辑？', exact: true }).getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  await expect(row(page, 'Code')).toContainText('待新增')
  await expect(row(page, 'Code')).not.toContainText('待删除')
  expect((await state()).drafts.at(-1).entries).toEqual(savedEntries)

  // Withdraw the saved add locally; now B is genuinely missing and delete must skip it.
  await page.getByTestId('edit-properties').click()
  await page.getByRole('button', { name: '撤销 Code', exact: true }).click()
  await expect(row(page, 'Code')).toContainText('2 / 3 个文件')
  await page.getByRole('checkbox', { name: '选择属性 Code', exact: true }).check()
  await page.getByRole('button', { name: '删除属性 (1)', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除属性', exact: true })
  await expect(dialog).toContainText('预计处理 2 项，跳过 1 项')
  await dialog.getByRole('button', { name: '加入编辑', exact: true }).click()
  await page.getByTestId('save-draft').click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  const deletions = (await state()).drafts.at(-1).entries
  expect(deletions).toHaveLength(2)
  expect(deletions.every(entry => entry.operation === 'delete' && entry.propertyName === 'Code')).toBe(true)
  expect(deletions.some(entry => entry.modelPath.endsWith('PartB.SLDPRT'))).toBe(false)
  expect((await state()).applies).toEqual([])
})
