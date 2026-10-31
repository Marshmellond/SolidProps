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
function render(selected: string[], editing = false, draft: Record<string, Change> = {}) {
  return renderToStaticMarkup(
    <PropertyWorkbench
      snapshot={snapshot}
      selected={new Set(selected)}
      onSelectionChange={vi.fn()}
      draft={draft}
      onDraftChange={vi.fn()}
      capabilities={{
        cadId: 'solidworks',
        displayName: 'SolidWorks',
        writable: true,
        configurations: false,
        designated: false,
        notes: '',
      }}
      editing={editing}
      busy={false}
      needsRefresh={false}
      onRefresh={vi.fn()}
    />,
  )
}
describe('selected-file longitudinal workbench', () => {
  it('shows an empty selection instead of all models or cross-file matrix', () => {
    const html = render([])
    expect(html).toContain('从左侧选择文件查看属性')
    expect(html).not.toContain('property-table')
    expect(html).not.toContain('最近提交结果')
  })
  it('shows only properties of the chosen file, read-only before edit', () => {
    const html = render(['b'])
    expect(html).toContain('属性值 材料')
    expect(html).not.toContain('属性值 供应商')
    expect(html).toContain('readOnly=""')
    expect(html).toMatch(/disabled=""[^>]*><svg[^]*?新增属性/)
  })
  it('enables single-file editing only in edit mode', () => {
    const html = render(['a'], true)
    expect(html).toContain('属性值 供应商')
    expect(html).not.toContain('readOnly=""')
    expect(html).not.toContain('多个不同值')
  })
  it('shows mixed values and coverage explicitly for multi-file selection', () => {
    const html = render(['a', 'b'])
    expect(html).toContain('已选 2 个文件')
    expect(html).toContain('多个不同值')
    expect(html).toContain('1 / 2 个文件')
    expect(html).toContain('批量编辑')
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
    expect(render(['b'], false, draft)).not.toContain('属性值 新属性')
    expect(render(['a'], false, draft)).toContain('待删除')
    expect(render(['a'], false, draft)).toContain('待新增')
  })
})
