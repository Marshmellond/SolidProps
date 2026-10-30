import { describe, expect, it } from 'vitest'
import { canEdit, cellKey, matchesOccurrence, rectangularPaste, updateDraft } from './editing'
import type { Capabilities, Model, Occurrence } from './types'
const capabilities: Capabilities = {
  cadId: 'solidworks',
  displayName: 'SolidWorks',
  writable: true,
  configurations: true,
  designated: false,
  notes: '',
}
const model: Model = {
  id: 'm',
  name: '零件',
  path: 'C:/models/part.SLDPRT',
  kind: 'part',
  configuration: '默认',
  scope: 'document',
  writable: true,
  reason: '',
  dirty: false,
  properties: ['编号', '材料'].map((name, i) => ({
    name,
    value: ['001', '铝'][i],
    writable: true,
    reason: '',
    evaluated: '',
    valueType: 'string',
  })),
}
describe('safe local editing', () => {
  it('disallows model, property, adapter, dirty and post-apply locks', () => {
    expect(canEdit(model, '编号', capabilities)).toBe(true)
    expect(canEdit({ ...model, writable: false }, '编号', capabilities)).toBe(false)
    expect(canEdit({ ...model, dirty: true }, '编号', capabilities)).toBe(false)
    expect(canEdit(model, '不存在', capabilities)).toBe(false)
    expect(canEdit(model, '编号', { ...capabilities, writable: false })).toBe(false)
    expect(canEdit(model, '编号', capabilities, true)).toBe(false)
  })
  it('retains original values and removes reverted drafts', () => {
    const one = updateDraft({}, model, '编号', '002')
    const two = updateDraft(one, model, '编号', '003')
    expect(two[cellKey('m', '编号')]).toEqual({
      modelId: 'm',
      propertyName: '编号',
      oldValue: '001',
      newValue: '003',
    })
    expect(updateDraft(two, model, '编号', '001')).toEqual({})
    expect(updateDraft({}, model, '未知', 'x')).toEqual({})
  })
  it('preserves staged additions and prevents editing staged deletions', () => {
    const add = {
      modelId: 'm',
      propertyName: '新属性',
      operation: 'add' as const,
      oldValue: '',
      newValue: 'A',
    }
    expect(
      updateDraft({ [cellKey('m', '新属性')]: add }, model, '新属性', 'B')[cellKey('m', '新属性')],
    ).toEqual({ ...add, newValue: 'B' })
    const del = {
      modelId: 'm',
      propertyName: '编号',
      operation: 'delete' as const,
      oldValue: '001',
      newValue: '',
    }
    expect(
      updateDraft({ [cellKey('m', '编号')]: del }, model, '编号', 'B')[cellKey('m', '编号')],
    ).toEqual(del)
  })
  it('pastes a rectangle and skips readonly and overflow cells', () => {
    const result = rectangularPaste(
      'A\tB\t越界\r\nC\tD\n',
      [model, { ...model, id: 'locked', writable: false }],
      ['编号', '材料'],
      0,
      0,
      capabilities,
    )
    expect(result.cells.map((c) => c.value)).toEqual(['A', 'B'])
    expect(result.skipped).toBe(3)
    expect(rectangularPaste('X', [model], ['编号'], 0, 0, capabilities, true).cells).toEqual([])
  })
  it('finds nested occurrences while retaining matching ancestors', () => {
    const tree: Occurrence = {
      id: 'a',
      name: 'Root',
      modelId: null,
      status: 'ok',
      children: [
        {
          id: 'b',
          name: 'Sub',
          modelId: null,
          status: 'ok',
          children: [
            {
              id: 'c',
              name: 'Input SHAFT',
              modelId: 'm',
              status: 'ok',
              children: [],
            },
          ],
        },
      ],
    }
    expect(matchesOccurrence(tree, 'shaft')).toBe(true)
    expect(matchesOccurrence(tree, '不存在')).toBe(false)
    expect(matchesOccurrence(tree, '')).toBe(true)
  })
})
