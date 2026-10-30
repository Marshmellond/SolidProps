import type { Capabilities, Change, Model, Occurrence } from './types'
export const cellKey = (modelId: string, propertyName: string) => `${modelId}\u0000${propertyName}`
export function canEdit(
  model: Model,
  propertyName: string,
  capabilities: Capabilities | null,
  locked = false,
): boolean {
  return !!(
    capabilities?.writable &&
    model.writable &&
    !model.dirty &&
    model.properties.find((p) => p.name === propertyName)?.writable &&
    !locked
  )
}
export function updateDraft(
  draft: Record<string, Change>,
  model: Model,
  propertyName: string,
  newValue: string,
): Record<string, Change> {
  const p = model.properties.find((p) => p.name === propertyName)
  const pending = draft[cellKey(model.id, propertyName)]
  if (pending?.operation === 'delete') return draft
  if (pending?.operation === 'add')
    return { ...draft, [cellKey(model.id, propertyName)]: { ...pending, newValue } }
  if (!p) return draft
  const next = { ...draft },
    key = cellKey(model.id, propertyName)
  if (p.value === newValue) delete next[key]
  else
    next[key] = {
      modelId: model.id,
      propertyName,
      oldValue: p.value,
      newValue,
    }
  return next
}
export function matchesOccurrence(node: Occurrence, query: string): boolean {
  return (
    !query ||
    node.name.toLowerCase().includes(query.toLowerCase()) ||
    node.children.some((c) => matchesOccurrence(c, query))
  )
}
export function rectangularPaste(
  text: string,
  models: Model[],
  columns: string[],
  startRow: number,
  startColumn: number,
  capabilities: Capabilities | null,
  locked = false,
  eligibility?: (model: Model, propertyName: string) => boolean,
) {
  const cells: { model: Model; propertyName: string; value: string }[] = []
  let skipped = 0
  text
    .replace(/\r/g, '')
    .replace(/\n$/, '')
    .split('\n')
    .forEach((row, dy) =>
      row.split('\t').forEach((value, dx) => {
        const model = models[startRow + dy],
          propertyName = columns[startColumn + dx]
        if (
          model &&
          propertyName &&
          !locked &&
          (eligibility
            ? eligibility(model, propertyName)
            : canEdit(model, propertyName, capabilities, locked))
        )
          cells.push({ model, propertyName, value })
        else skipped++
      }),
    )
  return { cells, skipped }
}
