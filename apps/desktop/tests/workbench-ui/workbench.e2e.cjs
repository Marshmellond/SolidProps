const { test: base, expect, _electron: electron } = require('@playwright/test')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const test = base.extend({
  harness: async ({}, use) => {
    const renderer = path.resolve(__dirname, '../../out/renderer/index.html')
    await fs.access(renderer).catch(() => { throw new Error('Build renderer first: pnpm --filter @solidprops/desktop build') })
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
      await expect(page.getByRole('list', { name: '模型文件', exact: true }).locator('li')).toHaveCount(3)
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
const fileButton = (page, name) => page.getByRole('button', { name: new RegExp(`^选择文件 ${name.replaceAll('.', '\\.')}`) })
const row = (page, name) => page.locator(`tbody tr`).filter({ has: page.locator(`.property-name-cell[title="${name}"]`) })
const valueAppearance = locator => locator.evaluate(element => {
  const style = getComputedStyle(element)
  return {
    border: style.border,
    outline: style.outline,
    boxShadow: style.boxShadow,
    background: style.backgroundColor,
  }
})
async function expectUnfocusedOutline(locator) {
  await expect(locator).toBeVisible()
  await expect(locator).not.toBeFocused()
  const border = await locator.evaluate(element => {
    const style = getComputedStyle(element)
    return { width: parseFloat(style.borderTopWidth), style: style.borderTopStyle, color: style.borderTopColor }
  })
  expect(border.width, 'unfocused editor retains a visible border').toBeGreaterThan(0)
  expect(border.style).not.toBe('none')
  expect(border.color).not.toMatch(/^(transparent|rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*)\)$/)
}
async function selectAndEdit(page, name) {
  await fileButton(page, name).click()
  await page.getByTestId('edit-properties').click()
}

test('connect → unique file view; selection is single-file; viewing is read-only', async ({ harness }) => {
  const { page, state, app, temporaryRoot } = harness
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByLabel('装配引用 2 次', { exact: true })).toHaveCount(1)
  await expect(page.locator('.matrix, .matrix-panel, .result-panel, .results-panel')).toHaveCount(0)
  await expect(page.getByTestId('submit-changes')).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: '全选当前可见文件' })).toHaveCount(0)
  await expect(page.getByText('批量编辑', { exact: true })).toHaveCount(0)
  await expect(page.getByText('仅共同属性', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '装配结构', exact: true })).toBeVisible()
  await expect(page.locator('.wordmark')).toContainText('SolidProps')

  await fileButton(page, 'FixtureAssembly.SLDASM').click()
  await expect(page.getByRole('heading', { name: 'FixtureAssembly.SLDASM', exact: true })).toBeVisible()
  await expect(page.locator('.readonly-banner')).toContainText('只读查看')
  await expect(page.locator('.readonly-banner').getByRole('button', { name: '编辑', exact: true })).toBeVisible()
  await expect(row(page, 'Material').locator('.property-display-value')).toHaveText('Steel')
  await expect(page.locator('.single-property-value')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '修改属性', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新增属性', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '撤销上一步', exact: true })).toHaveCount(0)

  await fileButton(page, 'PartA.SLDPRT').click()
  await expect(page.getByRole('heading', { name: 'PartA.SLDPRT', exact: true })).toBeVisible()
  await expect(row(page, 'Material').locator('.property-display-value')).toHaveText('Steel')
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('First part')
  await expect(row(page, 'Code').locator('.property-display-value')).toHaveText('A')
  await expect(page.getByText('存在于', { exact: false })).toHaveCount(0)

  // Search only filters the file list; the selected file stays selected.
  await page.getByRole('searchbox', { name: '搜索文件名或路径' }).fill('PartB')
  await expect(page.getByRole('list', { name: '模型文件', exact: true }).locator('li')).toHaveCount(1)
  await fileButton(page, 'PartB.SLDPRT').click()
  await expect(page.getByRole('heading', { name: 'PartB.SLDPRT', exact: true })).toBeVisible()
  await expect(row(page, 'Code')).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索文件名或路径' }).clear()
  await expect(fileButton(page, 'PartB.SLDPRT')).toHaveAttribute('aria-current', 'true')
  await expect(fileButton(page, 'PartA.SLDPRT')).not.toHaveAttribute('aria-current', 'true')

  // Workspace refresh reconnects and keeps the open file selected.
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'PartB.SLDPRT', exact: true })).toBeVisible()
  await expect(fileButton(page, 'PartB.SLDPRT')).toHaveAttribute('aria-current', 'true')

  await page.getByRole('textbox', { name: '查询属性', exact: true }).fill('no-match')
  await expect(page.getByText('没有符合查询条件的属性。', { exact: true })).toBeVisible()
  await expect(fileButton(page, 'PartB.SLDPRT')).toHaveAttribute('aria-current', 'true')
  await page.getByRole('textbox', { name: '查询属性', exact: true }).clear()
  await expect(row(page, 'Material').locator('.property-display-value')).toHaveText('Steel')

  // Reconnecting from the connection page stays there and marks the session connected.
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: '连接', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: '连接', exact: true })).toBeVisible()
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'PartB.SLDPRT', exact: true })).toBeVisible()
  const captured = await state()
  expect(captured.applies).toEqual([])
  expect(captured.calls.filter(call => call.channel === 'cad').map(call => call.method)).toEqual(['discover', 'connect', 'snapshot', 'disconnect', 'connect', 'snapshot', 'disconnect', 'connect', 'snapshot'])
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(temporaryRoot, 'user-data'))
})

test('single-file add skips existing; save gates submit and exact mocked apply payload', async ({ harness }) => {
  const { page, state } = harness
  await selectAndEdit(page, 'PartB.SLDPRT')
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

  const names = () => page.locator('.single-property-name').evaluateAll(inputs => inputs.map(input => input.value))
  expect(await names()).toEqual(['Material', 'Description'])
  await page.getByRole('button', { name: '新增属性', exact: true }).click()
  await page.getByRole('textbox', { name: '新增属性名称', exact: true }).fill('Code')
  await page.getByRole('textbox', { name: '新增属性值', exact: true }).fill('ADDED')
  await page.getByRole('textbox', { name: '新增属性值', exact: true }).press('Enter')
  await expect(row(page, 'Code').getByText('待提交', { exact: true })).toHaveAttribute('title', '新增')
  await expect(row(page, 'Code').locator('input.single-property-value')).toHaveValue('ADDED')
  await expect(page.getByRole('textbox', { name: '新增属性名称', exact: true })).toHaveCount(0)

  // Several new rows can be queued at once; each has confirm and cancel icons.
  await page.getByRole('button', { name: '新增属性', exact: true }).click()
  await page.getByRole('button', { name: '新增属性', exact: true }).click()
  const queued = page.locator('.property-row-new')
  await expect(queued).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await expect(queued.nth(index).getByRole('button', { name: '确认新增', exact: true })).toBeVisible()
    await expect(queued.nth(index).getByRole('button', { name: '取消新增', exact: true })).toBeVisible()
  }
  // Confirm stays dim until the name has content.
  await expect(queued.nth(0).getByRole('button', { name: '确认新增', exact: true })).toBeDisabled()
  await queued.nth(0).getByRole('textbox', { name: '新增属性名称', exact: true }).fill('Material')
  await expect(queued.nth(0).getByRole('button', { name: '确认新增', exact: true })).toBeEnabled()
  // Existing names are rejected in place without overwriting.
  await queued.nth(0).getByRole('button', { name: '确认新增', exact: true }).click()
  const duplicate = page.getByRole('dialog', { name: '属性名已存在', exact: true })
  await expect(duplicate).toContainText('属性名已存在')
  await expect(queued.nth(0).locator('.row-error')).toContainText('属性名已存在')
  await expect(queued.nth(0).getByRole('textbox', { name: '新增属性名称', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(row(page, 'Material').getByText('待提交', { exact: true })).toHaveCount(0)
  await expect(queued).toHaveCount(2)
  await duplicate.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(duplicate).toHaveCount(0)
  await queued.nth(0).getByRole('button', { name: '取消新增', exact: true }).click()
  await expect(queued).toHaveCount(1)
  await queued.nth(0).getByRole('button', { name: '取消新增', exact: true }).click()
  await expect(queued).toHaveCount(0)

  await row(page, 'Material').locator('input.single-property-value').fill('Aluminum')
  await expect(row(page, 'Material').getByText('待提交', { exact: true })).toHaveAttribute('title', '修改')
  await expect(page.getByTestId('save-draft')).toContainText('2')
  expect((await state()).applies).toEqual([])
  await page.getByTestId('save-draft').click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  let captured = await state()
  expect(captured.applies).toHaveLength(0)
  expect(captured.drafts.at(-1).entries).toHaveLength(2)
  await page.getByTestId('submit-changes').click()
  await expect(page.getByRole('dialog', { name: '提交属性修改', exact: true })).toContainText('1 个文件 · 2 项')
  expect((await state()).applies).toHaveLength(0)
  await page.getByTestId('apply-changes').click()
  await expect.poll(async () => (await state()).applies.length).toBe(1)
  captured = await state()
  expect(captured.applies[0]).toEqual({ snapshotId: 'mock-snapshot-1', confirmSave: true, changes: [
    { operation: 'add', modelId: 'part-b', propertyName: 'Code', oldValue: '', newValue: 'ADDED' },
    { operation: 'update', modelId: 'part-b', propertyName: 'Material', oldValue: 'Steel', newValue: 'Aluminum' },
  ] })
  await expect(page.getByTestId('submit-changes')).toBeDisabled()
  // The file that was open before submitting stays selected after the automatic re-read.
  await expect(fileButton(page, 'PartB.SLDPRT')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('heading', { name: 'PartB.SLDPRT', exact: true })).toBeVisible()
  await expect(page.locator('.matrix, .result-panel, .results-panel')).toHaveCount(0)
})

test('single-file inline edit and delete; top-bar assembly view is strictly read-only', async ({ harness }) => {
  const { page, state } = harness
  await selectAndEdit(page, 'PartA.SLDPRT')
  const description = row(page, 'Description').locator('input.single-property-value')
  await expect(description).toHaveValue('First part')
  await description.fill('First part edited')
  await expect(row(page, 'Description').getByText('待提交', { exact: true })).toHaveAttribute('title', '修改')
  await page.getByTestId('save-draft').click()
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('First part edited')
  await expect(page.locator('.single-property-value')).toHaveCount(0)

  await page.getByTestId('edit-properties').click()
  await page.getByRole('checkbox', { name: '选择属性 Description', exact: true }).check()
  await page.getByRole('button', { name: '删除属性 (1)', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '删除属性', exact: true })
  await expect(dialog).toContainText('以下 1 项属性将从当前文件移除')
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('（待删除）')
  await page.getByTestId('save-draft').click()
  const deletions = (await state()).drafts.at(-1).entries
  expect(deletions).toHaveLength(1)
  expect(deletions[0]).toEqual(expect.objectContaining({ propertyName: 'Description', operation: 'delete', oldValue: 'First part', newValue: '' }))
  await expect(page.getByTestId('submit-changes')).toBeEnabled()

  await page.getByRole('button', { name: '装配结构', exact: true }).click()
  const structure = page.getByRole('dialog', { name: '装配结构（只读）', exact: true })
  await expect(structure.getByLabel('搜索装配结构')).toBeVisible()
  await expect(structure.getByRole('treeitem')).toHaveCount(4)
  await expect(structure.locator('.assembly-static-tree button')).toHaveCount(1)
  await expect(structure.getByRole('button', { name: '收起全部', exact: true })).toBeVisible()
  await structure.getByLabel('搜索装配结构').fill('PartA-2')
  await expect(structure.getByRole('treeitem')).toHaveCount(2)
  await expect(structure.getByRole('treeitem', { name: /PartA-2/ })).toBeVisible()
  await expect(structure.getByRole('treeitem', { name: /PartA-1/ })).toHaveCount(0)
  await structure.getByRole('treeitem', { name: /PartA-2/ }).click()
  await expect(page.getByRole('heading', { name: 'PartA.SLDPRT', exact: true })).toBeVisible()
  await structure.getByRole('button', { name: '关闭装配结构', exact: true }).click()
  await expect(structure).toHaveCount(0)
  await expect(fileButton(page, 'PartA.SLDPRT')).toHaveAttribute('aria-current', 'true')
  expect((await state()).applies).toEqual([])
})

test('cancel restores the saved draft; a staged add can be withdrawn locally', async ({ harness }) => {
  const { page, state } = harness
  await selectAndEdit(page, 'PartB.SLDPRT')
  await page.getByRole('button', { name: '新增属性', exact: true }).click()
  await page.getByRole('textbox', { name: '新增属性名称', exact: true }).fill('Code')
  await page.getByRole('textbox', { name: '新增属性值', exact: true }).fill('ONLY-MISSING')
  await page.getByRole('textbox', { name: '新增属性值', exact: true }).press('Enter')
  await page.getByTestId('save-draft').click()
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  const savedEntries = (await state()).drafts.at(-1).entries
  expect(savedEntries).toEqual([expect.objectContaining({ propertyName: 'Code', operation: 'add', oldValue: '', newValue: 'ONLY-MISSING', modelPath: expect.stringContaining('PartB.SLDPRT') })])

  // Deleting a pending add withdraws it locally instead of issuing a CAD delete.
  await page.getByTestId('edit-properties').click()
  await page.getByRole('checkbox', { name: '选择属性 Code', exact: true }).check()
  await page.getByRole('button', { name: '删除属性 (1)', exact: true }).click()
  await page.getByRole('dialog', { name: '删除属性', exact: true }).getByRole('button', { name: '删除', exact: true }).click()
  await expect(row(page, 'Code')).toHaveCount(0)
  await page.getByTestId('cancel-edit').click()
  await page.getByRole('dialog', { name: '取消本次编辑？', exact: true }).getByRole('button', { name: '确认', exact: true }).click()
  await expect(row(page, 'Code').getByText('待提交', { exact: true })).toHaveAttribute('title', '新增')
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  expect((await state()).drafts.at(-1).entries).toEqual(savedEntries)

  await page.getByTestId('edit-properties').click()
  await page.getByRole('button', { name: '撤销 Code', exact: true }).click()
  await expect(row(page, 'Code')).toHaveCount(0)
  expect((await state()).applies).toEqual([])
})

test('view values ignore double-click editing; edit controls stay outlined without focus', async ({ harness }) => {
  const { page, state } = harness
  await fileButton(page, 'FixtureAssembly.SLDASM').click()
  const material = row(page, 'Material').locator('.property-display-value')
  await expect(material).toHaveText('Steel')
  const viewingAppearance = await valueAppearance(material)
  await material.dblclick()
  await expect(material).not.toBeFocused()
  await expect(page.locator('.vertical-properties input:not([type="checkbox"])')).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT')
  expect(await valueAppearance(material)).toEqual(viewingAppearance)
  await expect(page.getByTestId('submit-changes')).toBeDisabled()

  await page.getByTestId('edit-properties').click()
  const input = row(page, 'Material').locator('input.single-property-value')
  await expect(input).toHaveValue('Steel')
  await expect(input).toBeEditable()
  await page.getByRole('heading', { name: 'FixtureAssembly.SLDASM', exact: true }).click()
  await expectUnfocusedOutline(input)
  await input.fill('Aluminum')
  await page.getByRole('heading', { name: 'FixtureAssembly.SLDASM', exact: true }).click()
  await expectUnfocusedOutline(input)
  await expect(row(page, 'Material').getByText('待提交', { exact: true })).toHaveAttribute('title', '修改')
  await page.getByTestId('save-draft').click()
  await expect(row(page, 'Material').locator('.property-display-value')).toHaveText('Aluminum')
  await expect(page.locator('.single-property-value')).toHaveCount(0)
  expect((await state()).applies).toEqual([])
})

test('left rail switch target is the whole highlight and never selects text', async ({ harness }) => {
  const { page, state } = harness
  const workspace = page.getByRole('button', { name: '工作台', exact: true })
  const connections = page.getByRole('button', { name: '连接', exact: true })
  const clickEdge = async (button, round) => {
    const box = await button.boundingBox()
    expect(box, 'rail target remains measurable').not.toBeNull()
    await button.click({ position: { x: round % 2 ? 3 : box.width - 3, y: box.height - 4 } })
  }
  await page.getByRole('searchbox', { name: '搜索文件名或路径', exact: true }).fill('PartB')
  await fileButton(page, 'PartB.SLDPRT').click()
  for (let round = 0; round < 10; round++) {
    await test.step(`switch round ${round + 1}: whole highlighted rail button`, async () => {
      await clickEdge(connections, round)
      await expect(connections).toHaveClass(/active/)
      await expect(page.getByTestId('session-select')).toHaveCount(1)
      await clickEdge(workspace, round)
      await expect(workspace).toHaveClass(/active/)
      await expect(page.getByRole('list', { name: '模型文件', exact: true }).locator('li')).toHaveCount(3)
      await expect(fileButton(page, 'PartB.SLDPRT')).toHaveAttribute('aria-current', 'true')
    })
  }
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

  // The whole highlighted file row is the button, including its padding and badges.
  await page.getByRole('searchbox', { name: '搜索文件名或路径', exact: true }).clear()
  await fileButton(page, 'PartA.SLDPRT').click()
  const partB = fileButton(page, 'PartB.SLDPRT')
  expect(await partB.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const hits = [
      document.elementFromPoint(rect.left + 2, rect.top + 2),
      document.elementFromPoint(rect.right - 2, rect.bottom - 2),
      document.elementFromPoint(rect.right - 2, rect.top + rect.height / 2),
    ]
    return hits.every(hit => hit?.closest('.file-sidebar-file') === element) && getComputedStyle(element).cursor === 'pointer'
  })).toBe(true)
  const partBBox = await partB.boundingBox()
  await partB.click({ position: { x: partBBox.width - 3, y: partBBox.height - 3 } })
  await expect(partB).toHaveAttribute('aria-current', 'true')
  await expect(fileButton(page, 'PartA.SLDPRT')).not.toHaveAttribute('aria-current', 'true')
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

  expect((await state()).applies).toEqual([])
  expect((await state()).calls.filter(call => call.channel === 'cad').map(call => call.method)).toEqual(['discover', 'connect', 'snapshot'])
})

test('inline rename, undo, redo, and undo everything', async ({ harness }) => {
  const { page, state } = harness
  await selectAndEdit(page, 'PartA.SLDPRT')
  await expect(page.getByRole('button', { name: '修改属性', exact: true })).toHaveCount(0)
  const description = row(page, 'Description').locator('input.single-property-value')
  await description.fill('First part edited')
  await expect(row(page, 'Description').getByText('待提交', { exact: true })).toHaveAttribute('title', '修改')

  await page.getByRole('button', { name: '撤销上一步', exact: true }).click()
  await expect(description).toHaveValue('First part')
  await expect(row(page, 'Description').getByText('待提交', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重做上一步', exact: true }).click()
  await expect(description).toHaveValue('First part edited')
  await expect(row(page, 'Description').getByText('待提交', { exact: true })).toHaveAttribute('title', '修改')
  await page.getByRole('button', { name: '撤销上一步', exact: true }).click()
  await expect(description).toHaveValue('First part')

  // Property names are editable in place, with no separate update dialog.
  const codeName = row(page, 'Code').locator('input.single-property-name')
  await codeName.fill('编号')
  await codeName.press('Enter')
  await expect(row(page, '编号').getByText('待提交', { exact: true })).toHaveAttribute('title', '新增')
  await expect(row(page, 'Code').locator('.property-display-value')).toHaveText('（待删除）')
  await page.getByRole('button', { name: '撤销上一步', exact: true }).click()
  await expect(row(page, '编号')).toHaveCount(0)
  await expect(row(page, 'Code').locator('input.single-property-value')).toHaveValue('A')

  const descriptionAgain = row(page, 'Description').locator('input.single-property-value')
  await descriptionAgain.fill('First part again')
  await page.getByRole('button', { name: '撤回全部', exact: true }).click()
  await page.getByRole('dialog', { name: '撤回全部修改？', exact: true }).getByRole('button', { name: '确认', exact: true }).click()
  await expect(descriptionAgain).toHaveValue('First part')
  await expect(row(page, 'Description').getByText('待提交', { exact: true })).toHaveCount(0)
  await page.getByTestId('cancel-edit').click()
  await expect(page.getByTestId('submit-changes')).toBeDisabled()
  expect((await state()).applies).toEqual([])
})

test('each selected file shows only its own properties; no union, coverage, or common toggle', async ({ harness }) => {
  const { page, app, state } = harness
  // Enrich only this isolated in-memory mock; no fixture files or actual CAD data change.
  await app.evaluate(() => {
    const models = globalThis.__workbenchFixture.snapshot.models
    const property = (name, value) => ({ name, value, evaluated: value, valueType: 'text', writable: true, reason: '' })
    models.find(model => model.id === 'part-a').properties.push(property('SelectedOnly', 'A-only'))
    models.find(model => model.id === 'part-b').properties.push(property('UnselectedOnly', 'B-only'))
  })
  // Re-reading only happens from the connection page.
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await page.getByTestId('disconnect-button').click()
  await page.getByTestId('connect-button').click()
  await expect(page.getByRole('heading', { name: '文档属性', exact: true })).toBeVisible()
  await fileButton(page, 'PartA.SLDPRT').click()
  await expect(page.locator('.property-name-cell')).toHaveText(['Material', 'Description', 'Code', 'SelectedOnly'])
  await expect(row(page, 'UnselectedOnly')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: '仅共同属性', exact: true })).toHaveCount(0)
  await expect(page.getByText(/个文件$/)).toHaveCount(0)

  await fileButton(page, 'PartB.SLDPRT').click()
  await expect(page.locator('.property-name-cell')).toHaveText(['Material', 'Description', 'UnselectedOnly'])
  await expect(row(page, 'SelectedOnly')).toHaveCount(0)
  expect((await state()).applies).toEqual([])
})

test('saved draft survives reconnect and restores pending edits', async ({ harness }) => {
  const { page, state } = harness
  await selectAndEdit(page, 'PartA.SLDPRT')
  await row(page, 'Description').locator('input.single-property-value').fill('Draft survives reconnect')
  await page.getByTestId('save-draft').click()
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('Draft survives reconnect')
  expect((await state()).drafts.at(-1).entries).toHaveLength(1)

  await page.getByRole('button', { name: '连接', exact: true }).click()
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'PartA.SLDPRT', exact: true })).toBeVisible()
  await expect(fileButton(page, 'PartA.SLDPRT')).toHaveAttribute('aria-current', 'true')
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('Draft survives reconnect')
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  expect((await state()).applies).toEqual([])
})

test('submit preview cancel and delete cancel leave the model untouched', async ({ harness }) => {
  const { page, state } = harness
  await selectAndEdit(page, 'PartA.SLDPRT')
  await row(page, 'Material').locator('input.single-property-value').fill('Aluminum')
  await page.getByTestId('save-draft').click()
  await page.getByTestId('submit-changes').click()
  const preview = page.getByRole('dialog', { name: '提交属性修改', exact: true })
  await expect(preview).toContainText('1 个文件 · 1 项')
  await preview.getByRole('button', { name: '返回编辑', exact: true }).click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  expect((await state()).applies).toEqual([])

  await page.getByTestId('edit-properties').click()
  await page.getByRole('checkbox', { name: '选择属性 Description', exact: true }).check()
  await page.getByRole('button', { name: '删除属性 (1)', exact: true }).click()
  const removal = page.getByRole('dialog', { name: '删除属性', exact: true })
  await expect(removal).toContainText('以下 1 项属性将从当前文件移除')
  await removal.getByRole('button', { name: '取消', exact: true }).click()
  await expect(removal).toHaveCount(0)
  await expect(row(page, 'Description')).toHaveCount(1)
  await expect(row(page, 'Material').getByText('待提交', { exact: true })).toHaveAttribute('title', '修改')
  expect((await state()).applies).toEqual([])
})

test('apply exception surfaces the error, re-reads, and keeps the draft for retry', async ({ harness }) => {
  const { page, app, state } = harness
  await app.evaluate(() => { globalThis.__workbenchFixture.applyError = '模拟 CAD 写入失败' })
  await selectAndEdit(page, 'PartA.SLDPRT')
  await row(page, 'Description').locator('input.single-property-value').fill('Will fail')
  await page.getByTestId('save-draft').click()
  await page.getByTestId('submit-changes').click()
  await page.getByTestId('apply-changes').click()

  await expect(page.locator('.notice.error')).toContainText('模拟 CAD 写入失败')
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'PartA.SLDPRT', exact: true })).toBeVisible()
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('Will fail')
  expect((await state()).applies).toEqual([])
  expect((await state()).drafts.at(-1).entries).toHaveLength(1)
  // The automatic re-read must include the failed draft, not a cleared snapshot.
  expect((await state()).calls.filter(call => call.channel === 'cad').map(call => call.method)).toEqual([
    'discover', 'connect', 'snapshot', 'apply', 'snapshot',
  ])
})

test('partial write failure reports unfinished items and keeps only their draft', async ({ harness }) => {
  const { page, app, state } = harness
  await app.evaluate(() => { globalThis.__workbenchFixture.failedProperty = 'Description' })
  await selectAndEdit(page, 'PartA.SLDPRT')
  await row(page, 'Description').locator('input.single-property-value').fill('Not written')
  await row(page, 'Material').locator('input.single-property-value').fill('Aluminum')
  await page.getByTestId('save-draft').click()
  await page.getByTestId('submit-changes').click()
  await expect(page.getByRole('dialog', { name: '提交属性修改', exact: true })).toContainText('1 个文件 · 2 项')
  await page.getByTestId('apply-changes').click()

  await expect(page.locator('.notice')).toContainText('1 项成功，1 项未完成')
  await expect(page.getByTestId('submit-changes')).toBeEnabled()
  const draft = (await state()).drafts.at(-1)
  expect(draft.entries).toHaveLength(1)
  expect(draft.entries[0]).toEqual(expect.objectContaining({ propertyName: 'Description', newValue: 'Not written' }))
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('Not written')
  await expect(row(page, 'Material').locator('.property-display-value')).toHaveText('Aluminum')
})

test('conflicting draft is not loaded and the user is warned', async ({ harness }) => {
  const { page, app, state } = harness
  await selectAndEdit(page, 'PartA.SLDPRT')
  await row(page, 'Description').locator('input.single-property-value').fill('Local draft')
  await page.getByTestId('save-draft').click()

  // Simulate the CAD model changing while the draft was stored.
  await app.evaluate(() => {
    const model = globalThis.__workbenchFixture.snapshot.models.find(item => item.id === 'part-a')
    const property = model.properties.find(item => item.name === 'Description')
    property.value = property.evaluated = 'Changed in CAD'
  })
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()

  await expect(page.locator('.notice.error')).toContainText('1 项草稿与当前模型冲突')
  await expect(page.getByRole('heading', { name: 'PartA.SLDPRT', exact: true })).toBeVisible()
  await expect(row(page, 'Description').locator('.property-display-value')).toHaveText('Changed in CAD')
  await expect(row(page, 'Description').getByText('待提交', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('submit-changes')).toBeDisabled()
  expect((await state()).applies).toEqual([])
})

