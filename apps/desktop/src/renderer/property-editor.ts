import { cellKey } from './editing'
import type { Capabilities, Change, Model } from './types'

export type PropertyDraft = Readonly<Record<string, Change>>

export interface PropertyRow {
  name: string
  /** Shared effective value, or '' when mixed. Empty strings are real values. */
  value: string
  /** Compares present values only; absence is represented by present < total. */
  mixed: boolean
  present: number
  total: number
  added: number
  updated: number
  deleted: number
}

export interface PropertyOperation {
  operation: 'update' | 'add' | 'delete'
  name: string
  value?: string
  fillMissing?: boolean
}

export interface StagePropertyResult {
  draft: Record<string, Change>
  /** Targets whose staged state changed (including cancellation of a draft). */
  affected: number
  /** Protected, invalid, missing, duplicate, or already-satisfied targets. */
  skipped: number
  /** One human-model-name-prefixed explanation per skipped target; global errors also work with no selection. */
  reasons: string[]
}

// A selection may contain several occurrences of the same underlying model.
const uniqueModels = (models: readonly Model[]) => [
  ...new Map(models.map((model) => [model.id, model])).values(),
]

/**
 * Union in first-seen order: snapshot property names, then selected draft additions.
 * Names are exact/case-sensitive. Pending deletes remain present and show oldValue.
 * Counts are per distinct model, never per assembly occurrence. Unselected drafts
 * are ignored; legacy changes without an operation are updates.
 */
export function aggregatePropertyRows(
  models: readonly Model[],
  draft: PropertyDraft,
): PropertyRow[] {
  const selected = uniqueModels(models)
  const names = new Set(selected.flatMap((model) => model.properties.map((p) => p.name)))
  const ids = new Set(selected.map((model) => model.id))
  for (const change of Object.values(draft)) {
    if (ids.has(change.modelId) && change.operation === 'add') names.add(change.propertyName)
  }
  return [...names].map((name) => {
    const row: PropertyRow = {
      name,
      value: '',
      mixed: false,
      present: 0,
      total: selected.length,
      added: 0,
      updated: 0,
      deleted: 0,
    }
    let firstValue: string | undefined
    for (const model of selected) {
      const property = model.properties.find((p) => p.name === name)
      const pending = draft[cellKey(model.id, name)]
      if (!property && pending?.operation !== 'add') continue
      const value = pending
        ? pending.operation === 'delete'
          ? pending.oldValue
          : pending.newValue
        : property!.value
      row.present++
      if (firstValue === undefined) firstValue = value
      else if (firstValue !== value) row.mixed = true
      if (pending) {
        if (pending.operation === 'add') row.added++
        else if (pending.operation === 'delete') row.deleted++
        else row.updated++
      }
    }
    row.value = row.mixed ? '' : (firstValue ?? '')
    return row
  })
}

/**
 * Pure staging only; never mutates models, draft, or Change objects and performs
 * no CAD calls. Request names are trimmed, then matched exactly (case-sensitive).
 * Case variants of snapshot/draft names are rejected to match worker safety rules.
 * Blank/NUL names and names over 255 UTF-16 code units are rejected. Add/update
 * require a string value, including ''. Missing/unknown capabilities fail closed.
 *
 * Update skips absent properties unless fillMissing is true. Add never overwrites,
 * including pending deletes/adds. Update edits a pending add in place or restores
 * a pending delete; returning to original oldValue cancels an update/delete.
 * Delete cancels pending adds. Original oldValue survives every other transition.
 * All protections apply even to cancellation. No-ops count as skipped.
 */
export function stageProperty(
  models: readonly Model[],
  draft: PropertyDraft,
  request: PropertyOperation,
  capabilities?: Pick<Capabilities, 'writable'> | null,
  locked = false,
): StagePropertyResult {
  const selected = uniqueModels(models)
  const result: StagePropertyResult = { draft: { ...draft }, affected: 0, skipped: 0, reasons: [] }
  const nameCounts = new Map<string, number>()
  for (const model of selected) nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
  const label = (model: Model) =>
    (nameCounts.get(model.name) ?? 0) > 1
      ? `${model.name}（${model.path || '无文件路径'}）`
      : model.name
  // Conservative Unicode caseless guard: also catches expansions such as ß/SS,
  // ligatures, and final sigma. Deliberately rejects some extra variants rather
  // than allowing a batch which the worker's Python casefold would reject.
  const caseless = (value: string) => value.toUpperCase().toLowerCase()
  const name = request.name.trim()
  const invalid =
    !name || request.name.includes('\u0000') || name.length > 255
      ? '属性名须为1–255个字符，不能包含空字符。'
      : !['add', 'update', 'delete'].includes(request.operation)
        ? '属性操作无效。'
        : request.operation !== 'delete' && typeof request.value !== 'string'
          ? '新增或修改必须提供文本值。'
          : undefined
  if (invalid) {
    result.skipped = selected.length
    result.reasons = selected.length
      ? selected.map((model) => `${label(model)}：${invalid}`)
      : [invalid]
    return result
  }
  for (const model of selected) {
    const key = cellKey(model.id, name)
    const property = model.properties.find((p) => p.name === name)
    const pending = draft[key]
    const skip = (reason: string) => {
      result.skipped++
      result.reasons.push(`${label(model)}：${reason}`)
    }
    const protection = locked
      ? '编辑已锁定，请重新读取。'
      : !capabilities?.writable
        ? '适配器不可写或能力信息不可用。'
        : model.dirty
          ? '模型有未保存的CAD修改。'
          : !model.writable
            ? model.reason || '模型只读。'
            : property && !property.writable
              ? property.reason || '属性只读。'
              : undefined
    if (protection) {
      skip(protection)
      continue
    }
    const collides =
      model.properties.some((p) => p.name !== name && caseless(p.name) === caseless(name)) ||
      Object.values(draft).some(
        (entry) =>
          entry.modelId === model.id &&
          entry.propertyName !== name &&
          caseless(entry.propertyName) === caseless(name),
      )
    if (collides) {
      skip('存在大小写同名属性，请使用原属性名。')
      continue
    }
    const exists = !!property || pending?.operation === 'add'
    let next: Change | undefined
    if (request.operation === 'add') {
      if (exists) {
        skip('属性已存在，新增不会覆盖。')
        continue
      }
      next = {
        modelId: model.id,
        propertyName: name,
        operation: 'add',
        oldValue: '',
        newValue: request.value!,
      }
    } else if (request.operation === 'delete') {
      if (!exists) {
        skip('属性不存在。')
        continue
      }
      if (pending?.operation !== 'add') {
        next = {
          modelId: model.id,
          propertyName: name,
          operation: 'delete',
          oldValue: pending?.oldValue ?? property!.value,
          newValue: '',
        }
      }
    } else if (pending?.operation === 'add') {
      next = { ...pending, newValue: request.value! }
    } else if (!property) {
      if (!request.fillMissing) {
        skip('属性不存在；启用补齐后可新增。')
        continue
      }
      next = {
        modelId: model.id,
        propertyName: name,
        operation: 'add',
        oldValue: '',
        newValue: request.value!,
      }
    } else {
      const oldValue = pending?.oldValue ?? property.value
      if (request.value !== oldValue) {
        next = {
          modelId: model.id,
          propertyName: name,
          operation: 'update',
          oldValue,
          newValue: request.value!,
        }
      }
    }
    if (
      (!next && !pending) ||
      (next &&
        pending &&
        (next.operation ?? 'update') === (pending.operation ?? 'update') &&
        next.oldValue === pending.oldValue &&
        next.newValue === pending.newValue)
    ) {
      skip('内容未变化或已暂存。')
      continue
    }
    if (next) result.draft[key] = next
    else delete result.draft[key]
    result.affected++
  }
  return result
}
