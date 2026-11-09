import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PropertyWorkbench } from './PropertyWorkbench'
import type { Change, Model, Snapshot } from '../types'
const model = (id: string, properties: [string, string][]): Model => ({
  id,
  name: `${id}.SLDPRT`,
  path: `C:/work/${id}.SLDPRT`,
  kind: 'part',
  configuration: '',
  scope: 'document',
  writable: true,
  reason: '',
  dirty: false,
  properties: properties.map(([name, value]) => ({
    name,
    value,
    writable: true,
    reason: '',
    valueType: 'text',
    evaluated: value,
  })),
})
const models = [
  model('a', [
    ['材料', '钢'],
    ['供应商', '甲公司'],
  ]),
  model('b', [['材料', '铝']]),
]
const snapshot: Snapshot = {
  id: 's1',
  sessionId: 'session',
  title: 'test',
  cadId: 'solidworks',
  scope: 'document',
  models,
  root: { id: 'root', name: 'a', modelId: 'a', status: 'loaded', children: [] },
  warnings: [],
}
function render(selected: string | null, editing = false, draft: Record<string, Change> = {}) {
  return renderToStaticMarkup(
    <PropertyWorkbench
      snapshot={snapshot}
      selected={selected}
      onSelectionChange={vi.fn()}
      draft={draft}
      onDraftChange={vi.fn()}
      capabilities={{
        cadId: 'solidworks',
        displayName: 'SolidWorks',
        writable: true,
        notes: '',
      }}
      editing={editing}
      busy={false}
      needsRefresh={false}
      canUndo={editing && Object.keys(draft).length > 0}
      canRedo={false}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onUndoAll={vi.fn()}
      onEdit={vi.fn()}
    />,
  )
}
describe('single-file property workbench', () => {
  it('shows an empty selection instead of all models or a cross-file matrix', () => {
    const html = render(null)
    expect(html).toContain('未选择文件')
    expect(html).not.toContain('property-table')
    expect(html).not.toContain('最近提交结果')
  })
  it('has no workspace refresh or update-dialog entry', () => {
    const html = render('a')
    expect(html).not.toContain('重新读取')
    expect(html).not.toContain('修改属性')
    expect(html).not.toContain('属性名称 Code')
  })
  it('shows only properties of the chosen file, read-only before edit', () => {
    const html = render('b')
    expect(html).toContain('属性值 材料')
    expect(html).not.toContain('属性值 供应商')
    expect(html).toContain('class="property-display-value"')
    expect(html).not.toContain('class="single-property-value"')
    expect(html).toMatch(/disabled=""[^>]*><svg[^]*?新增属性/)
  })
  it('makes the read-only state explicit and offers an edit entry', () => {
    const html = render('a')
    expect(html).toContain('class="readonly-banner"')
    expect(html).toContain('只读查看')
    expect(html).toMatch(/class="button primary"[^>]*>编辑<\/button>/)
    expect(html).not.toContain('撤销上一步')
    expect(html).not.toContain('撤回全部')
  })
  it('enables single-file editing only in edit mode', () => {
    const html = render('a', true)
    expect(html).toContain('属性值 供应商')
    expect(html).not.toContain('readOnly=""')
    expect(html).not.toContain('class="readonly-banner"')
    expect(html).toContain('撤销上一步')
    expect(html).toContain('重做上一步')
    expect(html).toContain('撤回全部')
    expect(html).toContain('aria-label="属性名称 材料"')
    expect(html).toContain('class="single-property-name"')
  })
  it('does not render batch controls or other files in the single-file view', () => {
    const html = render('a')
    expect(html).not.toContain('批量编辑')
    expect(html).not.toContain('仅共同属性')
    expect(html).not.toContain('存在于')
    expect(html).not.toContain('已选 2 个文件')
    expect(html).toContain('供应商')
    expect(html).not.toContain('属性值 材料（')
  })
  it('keeps an addition local to its selected target and displays pending deletion', () => {
    const draft = {
      'a\u0000新属性': {
        modelId: 'a',
        propertyName: '新属性',
        operation: 'add' as const,
        oldValue: '',
        newValue: '值',
      },
      'a\u0000材料': {
        modelId: 'a',
        propertyName: '材料',
        operation: 'delete' as const,
        oldValue: '钢',
        newValue: '',
      },
    }
    expect(render('b', false, draft)).not.toContain('属性值 新属性')
    expect(render('a', false, draft)).toContain('待删除')
    expect(render('a', false, draft)).toContain('待提交')
    expect(render('a', false, draft)).not.toContain('待修改')
    expect(render('a', false, draft)).not.toContain('待新增')
  })
})
