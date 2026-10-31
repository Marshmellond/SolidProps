import { describe, expect, it } from 'vitest'
import { cellKey } from './editing'
import { aggregatePropertyRows, stageProperty } from './property-editor'
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
const stage = (models: Model[], draft: PropertyDraft, request: PropertyOperation) =>
  stageProperty(models, draft, request, writable)

describe('aggregatePropertyRows', () => {
  it('returns an empty union without models or properties and ignores foreign drafts', () => {
    const draft = draftOf(change('other', 'New', 'add', '', 'x'))
    expect(aggregatePropertyRows([], draft)).toEqual([])
    expect(aggregatePropertyRows([model('a', {})], draft)).toEqual([])
  })

  it('distinguishes shared empty values, mixed values, and missing values', () => {
    const rows = aggregatePropertyRows(
      [model('a', { Empty: '', Mixed: '', Missing: 'x' }), model('b', { Empty: '', Mixed: 'x' })],
      {},
    )
    expect(rows).toEqual([
      {
        name: 'Empty',
        value: '',
        mixed: false,
        present: 2,
        total: 2,
        added: 0,
        updated: 0,
        deleted: 0,
      },
      {
        name: 'Mixed',
        value: '',
        mixed: true,
        present: 2,
        total: 2,
        added: 0,
        updated: 0,
        deleted: 0,
      },
      {
        name: 'Missing',
        value: 'x',
        mixed: false,
        present: 1,
        total: 2,
        added: 0,
        updated: 0,
        deleted: 0,
      },
    ])
  })

  it('uses effective values and counts updates, additions, and visible pending deletions', () => {
    const rows = aggregatePropertyRows(
      [model('a'), model('b'), model('c', {})],
      draftOf(
        change('a', 'Code', undefined, '001', '002'),
        change('b', 'Code', 'delete', '001', ''),
        change('c', 'Code', 'add', '', '002'),
        change('a', 'New', 'add', '', ''),
        change('outside', 'Ignored', 'add', '', 'x'),
      ),
    )
    expect(rows).toEqual([
      {
        name: 'Code',
        value: '',
        mixed: true,
        present: 3,
        total: 3,
        added: 1,
        updated: 1,
        deleted: 1,
      },
      {
        name: 'New',
        value: '',
        mixed: false,
        present: 1,
        total: 3,
        added: 1,
        updated: 0,
        deleted: 0,
      },
    ])
  })

  it('deduplicates occurrences and retains exact case-sensitive names and first-seen order', () => {
    const a = model('a', { code: 'a', Code: 'b' })
    expect(
      aggregatePropertyRows([a, a], draftOf(change('a', 'Extra', 'add', '', 'e'))).map(
        ({ name, present, total }) => ({ name, present, total }),
      ),
    ).toEqual([
      { name: 'code', present: 1, total: 1 },
      { name: 'Code', present: 1, total: 1 },
      { name: 'Extra', present: 1, total: 1 },
    ])
  })
})

describe('stageProperty', () => {
  it('updates present properties, skips missing, and optionally fills missing with adds', () => {
    const models = [model('a'), model('b', {})]
    const result = stage(models, {}, { operation: 'update', name: 'Code', value: '002' })
    expect(result.affected).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.reasons[0]).toContain('b：属性不存在')
    const filled = stage(
      models,
      {},
      { operation: 'update', name: 'Code', value: '002', fillMissing: true },
    )
    expect(filled.affected).toBe(2)
    expect(filled.draft).toEqual(
      draftOf(change('a', 'Code', 'update', '001', '002'), change('b', 'Code', 'add', '', '002')),
    )
  })

  it('adds only where absent, trims names, and never overwrites actual or staged properties', () => {
    const models = [model('a'), model('b', {}), model('c'), model('d', {})]
    const draft = draftOf(
      change('c', 'Code', 'delete', '001', ''),
      change('d', 'Code', 'add', '', 'keep'),
    )
    const result = stage(models, draft, { operation: 'add', name: '  Code  ', value: 'new' })
    expect(result.affected).toBe(1)
    expect(result.skipped).toBe(3)
    expect(result.draft).toEqual({
      ...draft,
      [cellKey('b', 'Code')]: change('b', 'Code', 'add', '', 'new'),
    })
    expect(stage([model('a')], {}, { operation: 'add', name: 'code', value: '' }).affected).toBe(0)
  })

  it.each([
    ['Code', 'code'],
    ['Straße', 'STRASSE'],
    ['Σ', 'ς'],
    ['ﬃ', 'FFI'],
  ])('rejects caseless collisions %s / %s in actual and pending names', (existing, requested) => {
    for (const operation of ['add', 'update', 'delete'] as const) {
      const request = { operation, name: requested, value: 'x', fillMissing: true }
      const actual = stage([model('a', { [existing]: 'old' })], {}, request)
      expect(actual).toMatchObject({ affected: 0, skipped: 1, draft: {} })
      expect(actual.reasons[0]).toContain('大小写同名属性')
      for (const pendingOperation of ['add', 'update', 'delete'] as const) {
        const draft = draftOf(change('a', existing, pendingOperation, 'old', 'value'))
        expect(stage([model('a', {})], draft, request)).toMatchObject({
          affected: 0,
          skipped: 1,
          draft,
        })
      }
    }
  })

  it('prefixes concise Chinese reasons with model names and paths only for duplicate names', () => {
    const models = [
      { ...model('internal-a'), name: '零件', writable: false },
      { ...model('internal-b'), name: '零件', writable: false },
      { ...model('internal-c'), name: '装配', dirty: true },
    ]
    expect(stage(models, {}, { operation: 'update', name: 'Code', value: 'new' }).reasons).toEqual([
      '零件（C:/internal-a.part）：模型只读。',
      '零件（C:/internal-b.part）：模型只读。',
      '装配：模型有未保存的CAD修改。',
    ])
    expect(stage(models, {}, { operation: 'add', name: '', value: 'new' }).reasons[0]).toBe(
      '零件（C:/internal-a.part）：属性名须为1–255个字符，不能包含空字符。',
    )
  })

  it('updates pending additions in place and deletes them without producing a delete operation', () => {
    const models = [model('a', {})]
    const added = stage(models, {}, { operation: 'add', name: 'New', value: 'one' }).draft
    const edited = stage(models, added, { operation: 'update', name: 'New', value: '' })
    expect(edited.draft[cellKey('a', 'New')]).toEqual(change('a', 'New', 'add', '', ''))
    expect(stage(models, edited.draft, { operation: 'delete', name: 'New' }).draft).toEqual({})
    expect(added[cellKey('a', 'New')].newValue).toBe('one')
  })

  it('retains original oldValue through repeated updates and deletes, and supports undo', () => {
    const models = [model('a')]
    const one = stage(models, {}, { operation: 'update', name: 'Code', value: 'two' }).draft
    const two = stage(models, one, { operation: 'update', name: 'Code', value: 'three' }).draft
    expect(two[cellKey('a', 'Code')].oldValue).toBe('001')
    expect(stage(models, two, { operation: 'update', name: 'Code', value: '001' }).draft).toEqual(
      {},
    )
    const deleted = stage(models, two, { operation: 'delete', name: 'Code' }).draft
    expect(deleted[cellKey('a', 'Code')]).toEqual(change('a', 'Code', 'delete', '001', ''))
    expect(
      stage(models, deleted, { operation: 'update', name: 'Code', value: '001' }).draft,
    ).toEqual({})
    expect(
      stage(models, deleted, { operation: 'update', name: 'Code', value: 'four' }).draft,
    ).toEqual(draftOf(change('a', 'Code', 'update', '001', 'four')))
  })

  it('uses retained oldValue, not a later snapshot value, and supports legacy updates', () => {
    const models = [model('a', { Code: 'later' })]
    const original = draftOf(change('a', 'Code', undefined, 'original', 'two'))
    expect(
      stage(models, original, { operation: 'update', name: 'Code', value: 'original' }).draft,
    ).toEqual({})
    expect(
      stage(models, original, { operation: 'delete', name: 'Code' }).draft[cellKey('a', 'Code')]
        .oldValue,
    ).toBe('original')
  })

  it('skips no-ops, repeated deletions, absent deletes, and repeated pending-add values', () => {
    expect(
      stage([model('a')], {}, { operation: 'update', name: 'Code', value: '001' }).skipped,
    ).toBe(1)
    expect(stage([model('a')], {}, { operation: 'delete', name: 'Missing' }).skipped).toBe(1)
    const deleted = draftOf(change('a', 'Code', 'delete', '001', ''))
    expect(stage([model('a')], deleted, { operation: 'delete', name: 'Code' })).toMatchObject({
      affected: 0,
      skipped: 1,
      draft: deleted,
    })
    const added = draftOf(change('a', 'New', 'add', '', 'x'))
    expect(
      stage([model('a')], added, { operation: 'update', name: 'New', value: 'x' }).affected,
    ).toBe(0)
  })

  it.each(['add', 'update', 'delete'] as const)(
    'enforces model, property, dirty, adapter, and global protection for %s',
    (operation) => {
      const models = [
        { ...model('readonly'), writable: false, reason: 'Locked document' },
        { ...model('dirty'), dirty: true },
        {
          ...model('property'),
          properties: model('property').properties.map((p) => ({
            ...p,
            writable: false,
            reason: 'Locked field',
          })),
        },
        model('ok'),
      ]
      const request = { operation, name: 'Code', value: 'new', fillMissing: true }
      const result = stage(models, {}, request)
      expect(result.skipped).toBe(3 + (operation === 'add' ? 1 : 0))
      expect(result.reasons.join(' ')).toContain('Locked document')
      expect(result.reasons.join(' ')).toContain('Locked field')
      for (const capabilities of [undefined, null, { writable: false }]) {
        expect(stageProperty(models, {}, request, capabilities).skipped).toBe(4)
      }
      expect(stageProperty(models, {}, request, writable, true).skipped).toBe(4)
    },
  )

  it('also protects creation and cancellation when models become dirty or locked', () => {
    const models = [{ ...model('a', {}), dirty: true }]
    const draft = draftOf(change('a', 'New', 'add', '', 'x'))
    expect(stage(models, draft, { operation: 'delete', name: 'New' }).draft).toEqual(draft)
    expect(stage(models, {}, { operation: 'add', name: 'New', value: 'x' }).skipped).toBe(1)
    expect(
      stage(models, {}, { operation: 'update', name: 'New', value: 'x', fillMissing: true })
        .skipped,
    ).toBe(1)
  })

  it.each(['', '   \t\n', 'Bad\u0000Name', 'x'.repeat(256)])(
    'rejects invalid names without changing any draft (%j)',
    (name) => {
      const draft = draftOf(change('outside', 'Code', 'update', 'old', 'new'))
      const result = stage([model('a'), model('b')], draft, { operation: 'add', name, value: 'x' })
      expect(result).toMatchObject({ draft, affected: 0, skipped: 2 })
      expect(result.reasons).toHaveLength(2)
      expect(result.reasons[0]).toContain('属性名须为')
    },
  )

  it('accepts the 255-character boundary, requires explicit values, and handles no selection', () => {
    expect(
      stage([model('a')], {}, { operation: 'add', name: 'x'.repeat(255), value: '' }).affected,
    ).toBe(1)
    for (const operation of ['add', 'update'] as const) {
      expect(stage([model('a')], {}, { operation, name: 'Code' }).skipped).toBe(1)
    }
    expect(stage([], {}, { operation: 'add', name: 'Code', value: 'x' })).toEqual({
      draft: {},
      affected: 0,
      skipped: 0,
      reasons: [],
    })
    expect(stage([], {}, { operation: 'add', name: '' }).reasons).toHaveLength(1)
  })

  it('does not mutate frozen inputs, preserves unrelated drafts, and deduplicates selected occurrences', () => {
    const a = model('a')
    a.properties.forEach(Object.freeze)
    Object.freeze(a.properties)
    Object.freeze(a)
    const foreign = Object.freeze(change('other', 'New', 'add', '', 'foreign'))
    const draft = Object.freeze(draftOf(foreign))
    const result = stage([a, a], draft, { operation: 'update', name: 'Code', value: 'new' })
    expect(result.affected).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.draft[cellKey('other', 'New')]).toBe(foreign)
    expect(Object.keys(draft)).toHaveLength(1)
    expect(a.properties[0].value).toBe('001')
    expect(aggregatePropertyRows([a], draft)[0].value).toBe('001')
  })
})
