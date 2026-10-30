import type { Change, Snapshot } from './types'
import { cellKey } from './editing'

export interface DraftEntry {
  modelPath: string
  propertyName: string
  operation?: 'add' | 'update' | 'delete'
  oldValue: string
  newValue: string
}
export interface SavedDraft {
  id: string
  savedAt: string
  cadId: string
  rootPath: string
  scope: string
  entries: DraftEntry[]
}
export const normalizedPath = (path: string) => path.replace(/\\/g, '/').toLowerCase()
export function draftKey(snapshot: Snapshot) {
  const root = snapshot.models.find((m) => m.id === snapshot.root.modelId)
  if (!root?.path) throw new Error('当前模型没有可用于保存草稿的文件路径。')
  return { cadId: snapshot.cadId, rootPath: root.path, scope: snapshot.scope }
}
export function draftEntries(snapshot: Snapshot, changes: Change[]): DraftEntry[] {
  return changes.map(({ modelId, ...entry }) => {
    const model = snapshot.models.find((m) => m.id === modelId)
    if (!model?.path) throw new Error('变更模型已失效，请重新读取。')
    return { ...entry, modelPath: model.path, operation: entry.operation ?? 'update' }
  })
}
// Persistent drafts never trust old session modelIds. Rebind by exact normalized
// path and validate against the fresh snapshot before enabling submission.
export function restoreDraft(snapshot: Snapshot, saved: SavedDraft) {
  const changes: Record<string, Change> = {}
  const conflicts: DraftEntry[] = []
  for (const entry of saved.entries) {
    const model = snapshot.models.find(
      (m) => normalizedPath(m.path) === normalizedPath(entry.modelPath),
    )
    const prop = model?.properties.find(
      (p) => p.name.toLowerCase() === entry.propertyName.toLowerCase(),
    )
    const operation = entry.operation ?? 'update'
    const alreadyApplied = operation === 'delete' ? !prop : prop?.value === entry.newValue
    if (
      model &&
      !model.dirty &&
      alreadyApplied &&
      (operation === 'add' || operation === 'delete' || entry.oldValue !== entry.newValue)
    )
      continue
    const valid =
      model &&
      model.writable &&
      !model.dirty &&
      (operation === 'add' ? !prop : prop?.writable && prop.value === entry.oldValue)
    if (!valid) {
      conflicts.push(entry)
      continue
    }
    const name = prop?.name ?? entry.propertyName
    changes[cellKey(model.id, name)] = {
      modelId: model.id,
      propertyName: name,
      operation,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
    }
  }
  return { changes, conflicts }
}
export function draftSignature(changes: Record<string, Change>) {
  return JSON.stringify(
    Object.values(changes).sort((a, b) =>
      cellKey(a.modelId, a.propertyName).localeCompare(cellKey(b.modelId, b.propertyName)),
    ),
  )
}
