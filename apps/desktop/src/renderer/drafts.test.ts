import { describe, it, expect } from 'vitest'
import { draftEntries, draftKey, draftSignature, restoreDraft, type SavedDraft } from './drafts'
import type { Snapshot, Change } from './types'
const snapshot: Snapshot = {
  id: 'new',
  sessionId: 'new-session',
  cadId: 'solidworks',
  scope: 'document',
  title: 'part',
  root: { id: 'root', name: 'part', modelId: 'new-id', children: [], status: 'loaded' },
  warnings: [],
  models: [
    {
      id: 'new-id',
      name: 'part',
      path: 'C:\\parts\\part.SLDPRT',
      kind: 'part',
      configuration: '',
      scope: 'document',
      writable: true,
      dirty: false,
      reason: '',
      properties: [
        {
          name: '名称',
          value: '原值',
          valueType: 'text',
          writable: true,
          reason: '',
          evaluated: '原值',
        },
      ],
    },
  ],
}
const entry = {
  modelPath: 'c:/parts/part.sldprt',
  propertyName: '名称',
  oldValue: '原值',
  newValue: '新值',
}
const saved: SavedDraft = {
  id: '1',
  savedAt: '2026-01-01',
  ...draftKey(snapshot),
  entries: [entry],
}
describe('durable draft binding', () => {
  it('persists file identity not session model ids', () => {
    const changes: Change[] = [
      { modelId: 'new-id', propertyName: '名称', oldValue: '原值', newValue: '新值' },
    ]
    const entries = draftEntries(snapshot, changes)
    expect(entries[0]).not.toHaveProperty('modelId')
    expect(entries[0].modelPath).toBe(snapshot.models[0].path)
  })
  it('rebinds compatible drafts to fresh model ids', () => {
    const result = restoreDraft(snapshot, saved)
    expect(result.conflicts).toEqual([])
    expect(Object.values(result.changes)[0].modelId).toBe('new-id')
  })
  it('refuses drafts whose original value changed or model is dirty', () => {
    expect(
      restoreDraft(snapshot, { ...saved, entries: [{ ...entry, oldValue: '过期' }] }).conflicts,
    ).toHaveLength(1)
    const dirty = structuredClone(snapshot)
    dirty.models[0].dirty = true
    expect(restoreDraft(dirty, saved).conflicts).toHaveLength(1)
  })
  it('accepts absent adds and rejects add collisions', () => {
    expect(
      restoreDraft(snapshot, {
        ...saved,
        entries: [{ ...entry, operation: 'add', propertyName: '新属性', oldValue: '' }],
      }).conflicts,
    ).toHaveLength(0)
    expect(
      restoreDraft(snapshot, { ...saved, entries: [{ ...entry, operation: 'add', oldValue: '' }] })
        .conflicts,
    ).toHaveLength(1)
  })
  it('does not resubmit a clean model already matching a submitted draft', () => {
    const applied = structuredClone(snapshot)
    applied.models[0].properties[0].value = '新值'
    expect(Object.keys(restoreDraft(applied, saved).changes)).toHaveLength(0)
    expect(restoreDraft(applied, saved).conflicts).toHaveLength(0)
  })
  it('detects changes in operation and value after save', () => {
    const changes = restoreDraft(snapshot, saved).changes
    const before = draftSignature(changes)
    const edited = structuredClone(changes)
    Object.values(edited)[0].newValue = '又改了'
    expect(draftSignature(edited)).not.toBe(before)
  })
})
