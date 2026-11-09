import { describe, expect, it } from 'vitest'
import { cellKey } from './editing'
import { propertyRows, renameProperty, stageProperty } from './property-editor'
import type { PropertyDraft, PropertyOperation } from './property-editor'
import type { Change, Model } from './types'

const writable = { writable: true }
const model = (id: string, values: Record<string, string> = { Code: '001' }): Model => ({
  id,
  name: id,
  path: `C:/${id}.part`,
  kind: 'part',
  configuration: '',
  scope: 'document',
  writable: true,
  dirty: false,
  reason: '',
  properties: Object.entries(values).map(([name, value]) => ({
    name,
    value,
    valueType: 'string',
    writable: true,
    reason: '',
    evaluated: '',
  })),
})
const change = (
  modelId: string,
  propertyName: string,
  operation: Change['operation'],
  oldValue: string,
  newValue: string,
): Change => ({ modelId, propertyName, operation, oldValue, newValue })
const draftOf = (...changes: Change[]): Record<string, Change> =>
  Object.fromEntries(changes.map((c) => [cellKey(c.modelId, c.propertyName), c]))
const stage = (
  target: Model | null,
  draft: PropertyDraft,
  request: PropertyOperation,
  capabilities = writable,
  locked = false,
) => stageProperty(target, draft, request, capabilities, locked)

describe('propertyRows', () => {
  it('returns no rows without a selected model or properties and ignores foreign drafts', () => {
    const draft = draftOf(change('other', 'New', 'add', '', 'x'))
    expect(propertyRows(null, draft)).toEqual([])
    expect(propertyRows(model('a', {}), draft)).toEqual([])
  })

  it('uses effective values, includes pending additions, and shows the old value for deletions', () => {
    const rows = propertyRows(
      model('a', { Code: '001', Empty: '' }),
      draftOf(
        change('a', 'Code', undefined, '001', '002'),
        change('a', 'Empty', 'delete', '', ''),
        change('a', 'New', 'add', '', ''),
        change('outside', 'Ignored', 'add', '', 'x'),
      ),
    )
    expect(rows).toEqual([
      { name: 'Code', value: '002' },
      { name: 'Empty', value: '' },
      { name: 'New', value: '' },
    ])
  })

  it('retains exact case-sensitive names and first-seen order without duplicating a staged add', () => {
    const rows = propertyRows(
      model('a', { code: 'a', Code: 'b' }),
      draftOf(change('a', 'Extra', 'add', '', 'e'), change('a', 'Code', 'add', '', 'staged')),
    )
    expect(rows).toEqual([
      { name: 'code', value: 'a' },
      { name: 'Code', value: 'staged' },
      { name: 'Extra', value: 'e' },
    ])
  })

  it('does not mutate the model or draft', () => {
    const target = model('a')
    const draft = Object.freeze(draftOf(change('a', 'Code', 'update', '001', '002')))
    const before = JSON.stringify(target)
    propertyRows(target, draft)
    expect(JSON.stringify(target)).toBe(before)
    expect(Object.keys(draft)).toHaveLength(1)
  })
})

describe('stageProperty', () => {
  it('updates present properties and skips missing ones', () => {
    expect(
      stage(model('a'), {}, { operation: 'update', name: 'Code', value: '002' }).draft,
    ).toEqual(draftOf(change('a', 'Code', 'update', '001', '002')))
    const missing = stage(model('b', {}), {}, { operation: 'update', name: 'Code', value: '002' })
    expect(missing).toMatchObject({ affected: 0, skipped: 1, draft: {} })
    expect(missing.reasons[0]).toBe('b：属性不存在。')
  })

  it('adds only where absent, trims names, and never overwrites actual or staged properties', () => {
    expect(
      stage(model('a', {}), {}, { operation: 'add', name: '  Code  ', value: 'new' }).draft,
    ).toEqual(draftOf(change('a', 'Code', 'add', '', 'new')))
    expect(stage(model('a'), {}, { operation: 'add', name: 'Code', value: 'new' })).toMatchObject({
      affected: 0,
      skipped: 1,
    })
    expect(
      stage(
        model('a'),
        draftOf(change('a', 'Code', 'delete', '001', '')),
        { operation: 'add', name: 'Code', value: 'new' },
      ).affected,
    ).toBe(0)
  })

  it.each([
    ['Code', 'code'],
    ['Straße', 'STRASSE'],
    ['Σ', 'ς'],
    ['ﬃ', 'FFI'],
  ])('rejects caseless collisions %s / %s in actual and pending names', (existing, requested) => {
    for (const operation of ['add', 'update', 'delete'] as const) {
      const request = { operation, name: requested, value: 'x' }
      const actual = stage(model('a', { [existing]: 'old' }), {}, request)
      expect(actual).toMatchObject({ affected: 0, skipped: 1, draft: {} })
      expect(actual.reasons[0]).toContain('大小写同名属性')
      const draft = draftOf(change('a', existing, operation, 'old', 'value'))
      expect(stage(model('a', {}), draft, request)).toMatchObject({
        affected: 0,
        skipped: 1,
        draft,
      })
    }
  })

  it('prefixes concise Chinese reasons with the model name', () => {
    const readonly = { ...model('internal-a'), name: '零件', writable: false }
    expect(
      stage(readonly, {}, { operation: 'update', name: 'Code', value: 'new' }).reasons,
    ).toEqual(['零件：模型只读。'])
    expect(stage(readonly, {}, { operation: 'add', name: '', value: 'new' }).reasons[0]).toBe(
      '零件：属性名须为1–255个字符，不能包含空字符。',
    )
  })

  it('updates pending additions in place and deletes them without producing a delete operation', () => {
    const target = model('a', {})
    const added = stage(target, {}, { operation: 'add', name: 'New', value: 'one' }).draft
    const edited = stage(target, added, { operation: 'update', name: 'New', value: '' })
    expect(edited.draft[cellKey('a', 'New')]).toEqual(change('a', 'New', 'add', '', ''))
    expect(stage(target, edited.draft, { operation: 'delete', name: 'New' }).draft).toEqual({})
    expect(added[cellKey('a', 'New')].newValue).toBe('one')
  })

  it('retains original oldValue through repeated updates and deletes, and supports undo', () => {
    const target = model('a')
    const one = stage(target, {}, { operation: 'update', name: 'Code', value: 'two' }).draft
    const two = stage(target, one, { operation: 'update', name: 'Code', value: 'three' }).draft
    expect(two[cellKey('a', 'Code')].oldValue).toBe('001')
    expect(stage(target, two, { operation: 'update', name: 'Code', value: '001' }).draft).toEqual(
      {},
    )
    const deleted = stage(target, two, { operation: 'delete', name: 'Code' }).draft
    expect(deleted[cellKey('a', 'Code')]).toEqual(change('a', 'Code', 'delete', '001', ''))
    expect(
      stage(target, deleted, { operation: 'update', name: 'Code', value: '001' }).draft,
    ).toEqual({})
    expect(
      stage(target, deleted, { operation: 'update', name: 'Code', value: 'four' }).draft,
    ).toEqual(draftOf(change('a', 'Code', 'update', '001', 'four')))
  })

  it('uses retained oldValue, not a later snapshot value, and supports legacy updates', () => {
    const target = model('a', { Code: 'later' })
    const original = draftOf(change('a', 'Code', undefined, 'original', 'two'))
    expect(
      stage(target, original, { operation: 'update', name: 'Code', value: 'original' }).draft,
    ).toEqual({})
    expect(
      stage(target, original, { operation: 'delete', name: 'Code' }).draft[cellKey('a', 'Code')]
        .oldValue,
    ).toBe('original')
  })

  it('skips no-ops, repeated deletions, absent deletes, and repeated pending-add values', () => {
    expect(stage(model('a'), {}, { operation: 'update', name: 'Code', value: '001' }).skipped).toBe(
      1,
    )
    expect(stage(model('a'), {}, { operation: 'delete', name: 'Missing' }).skipped).toBe(1)
    const deleted = draftOf(change('a', 'Code', 'delete', '001', ''))
    expect(stage(model('a'), deleted, { operation: 'delete', name: 'Code' })).toMatchObject({
      affected: 0,
      skipped: 1,
      draft: deleted,
    })
    const added = draftOf(change('a', 'New', 'add', '', 'x'))
    expect(stage(model('a'), added, { operation: 'update', name: 'New', value: 'x' }).affected).toBe(
      0,
    )
  })

  it.each(['add', 'update', 'delete'] as const)(
    'enforces model, property, dirty, adapter, and global protection for %s',
    (operation) => {
      const request = { operation, name: 'Code', value: 'new' }
      const readonly = stage({ ...model('readonly'), writable: false, reason: 'Locked document' }, {}, request)
      expect(readonly).toMatchObject({ affected: 0, skipped: 1 })
      expect(readonly.reasons[0]).toContain('Locked document')
      const dirty = stage({ ...model('dirty'), dirty: true }, {}, request)
      expect(dirty).toMatchObject({ affected: 0, skipped: 1 })
      expect(dirty.reasons[0]).toContain('未保存的CAD修改')
      const lockedProperty = stage(
        {
          ...model('property'),
          properties: model('property').properties.map((p) => ({
            ...p,
            writable: false,
            reason: 'Locked field',
          })),
        },
        {},
        request,
      )
      expect(lockedProperty).toMatchObject({ affected: 0, skipped: 1 })
      expect(lockedProperty.reasons[0]).toContain('Locked field')
      for (const capabilities of [undefined, null, { writable: false }])
        expect(stageProperty(model('ok'), {}, request, capabilities)).toMatchObject({
          affected: 0,
          skipped: 1,
        })
      expect(stage(model('ok'), {}, request, writable, true)).toMatchObject({
        affected: 0,
        skipped: 1,
      })
    },
  )

  it('also protects creation and cancellation when the model becomes dirty or locked', () => {
    const target = { ...model('a', {}), dirty: true }
    const draft = draftOf(change('a', 'New', 'add', '', 'x'))
    expect(stage(target, draft, { operation: 'delete', name: 'New' }).draft).toEqual(draft)
    expect(stage(target, {}, { operation: 'add', name: 'New', value: 'x' }).skipped).toBe(1)
  })

  it.each(['', '   \t\n', 'Bad\u0000Name', 'x'.repeat(256)])(
    'rejects invalid names without changing the draft (%j)',
    (name) => {
      const draft = draftOf(change('outside', 'Code', 'update', 'old', 'new'))
      const result = stage(model('a'), draft, { operation: 'add', name, value: 'x' })
      expect(result).toMatchObject({ draft, affected: 0, skipped: 1 })
      expect(result.reasons).toHaveLength(1)
      expect(result.reasons[0]).toContain('属性名须为')
    },
  )

  it('accepts the 255-character boundary, requires explicit values, and handles no selection', () => {
    expect(
      stage(model('a'), {}, { operation: 'add', name: 'x'.repeat(255), value: '' }).affected,
    ).toBe(1)
    for (const operation of ['add', 'update'] as const)
      expect(stage(model('a'), {}, { operation, name: 'Code' }).skipped).toBe(1)
    expect(stage(null, {}, { operation: 'add', name: 'Code', value: 'x' })).toEqual({
      draft: {},
      affected: 0,
      skipped: 0,
      reasons: [],
    })
    expect(stage(null, {}, { operation: 'add', name: '' }).reasons).toHaveLength(1)
  })

  it('does not mutate frozen inputs and preserves unrelated drafts', () => {
    const target = model('a')
    target.properties.forEach(Object.freeze)
    Object.freeze(target.properties)
    Object.freeze(target)
    const foreign = Object.freeze(change('other', 'New', 'add', '', 'foreign'))
    const draft = Object.freeze(draftOf(foreign))
    const result = stage(target, draft, { operation: 'update', name: 'Code', value: 'new' })
    expect(result.affected).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.draft[cellKey('other', 'New')]).toBe(foreign)
    expect(Object.keys(draft)).toHaveLength(1)
    expect(target.properties[0].value).toBe('001')
    expect(propertyRows(target, draft)[0].value).toBe('001')
  })
})

describe('renameProperty', () => {
  const rename = (
    target: Model | null,
    draft: PropertyDraft,
    oldName: string,
    newName: string,
    value: string,
    capabilities: { writable: boolean } | null | undefined = writable,
    locked = false,
  ) => renameProperty(target, draft, oldName, newName, value, capabilities, locked)

  it('stages an existing property rename as delete plus add while keeping the new value', () => {
    const result = rename(model('a'), {}, 'Code', ' 编号 ', '002')
    expect(result.affected).toBe(2)
    expect(result.draft).toEqual({
      ...draftOf(change('a', 'Code', 'delete', '001', '')),
      ...draftOf(change('a', '编号', 'add', '', '002')),
    })
  })

  it('keeps the original oldValue when renaming an already edited property', () => {
    const result = rename(model('a'), draftOf(change('a', 'Code', 'update', '001', '002')), 'Code', '编号', '003')
    expect(result.draft[cellKey('a', 'Code')]).toEqual(change('a', 'Code', 'delete', '001', ''))
    expect(result.draft[cellKey('a', '编号')]).toEqual(change('a', '编号', 'add', '', '003'))
  })

  it('renames a pending addition in place without creating a delete', () => {
    const draft = draftOf(change('a', 'New', 'add', '', 'one'))
    const result = rename(model('a', {}), draft, 'New', 'Final', 'two')
    expect(result.affected).toBe(1)
    expect(result.draft).toEqual(draftOf(change('a', 'Final', 'add', '', 'two')))
  })

  it('delegates to a plain value update when the name is unchanged', () => {
    const result = rename(model('a'), {}, 'Code', 'Code', '002')
    expect(result.draft).toEqual(draftOf(change('a', 'Code', 'update', '001', '002')))
  })

  it('rejects collisions, missing or deleted targets, invalid names, and protected models', () => {
    expect(rename(model('a', { Code: '001', Supplier: 'x' }), {}, 'Code', 'Supplier', 'x')).toMatchObject({
      affected: 0,
      skipped: 1,
    })
    expect(rename(model('a'), {}, 'Missing', 'Code', 'x').reasons[0]).toContain('属性不存在')
    expect(
      rename(model('a'), draftOf(change('a', 'Code', 'delete', '001', '')), 'Code', '编号', 'x')
        .reasons[0],
    ).toContain('已标记删除')
    expect(rename(model('a'), {}, 'Code', '', 'x').reasons[0]).toContain('属性名须为')
    expect(rename(model('a'), {}, 'Code', '   ', 'x').reasons[0]).toContain('属性名须为')
    for (const target of [null, { writable: false }])
      expect(rename(model('a'), {}, 'Code', '编号', 'x', target).skipped).toBe(1)
    expect(renameProperty(model('a'), {}, 'Code', '编号', 'x', undefined).skipped).toBe(1)
    expect(rename({ ...model('a'), dirty: true }, {}, 'Code', '编号', 'x').skipped).toBe(1)
    expect(rename(model('a'), {}, 'Code', '编号', 'x', writable, true).skipped).toBe(1)
  })
})
