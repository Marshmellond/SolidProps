import { cellKey } from './editing'
import type { Capabilities, Change, Model } from './types'

export type PropertyDraft = Readonly<Record<string, Change>>

export interface PropertyRow {
  name: string
  /** Effective staged value; pending deletions retain the original value for preview. */
  value: string
}

export interface PropertyOperation {
  operation: 'update' | 'add' | 'delete'
  name: string
  value?: string
}

export interface StagePropertyResult {
  draft: Record<string, Change>
  /** Targets whose staged state changed (including cancellation of a draft). */
  affected: number
  /** Protected, invalid, missing, duplicate, or already-satisfied targets. */
  skipped: number
  /** One human-model-name-prefixed explanation per skipped target; global errors also work with no model. */
  reasons: string[]
}

/**
 * Existing properties of the selected file, followed by its pending additions.
 * Names are exact/case-sensitive. Pending deletes remain present and show oldValue.
 * Drafts for other files are ignored; legacy changes without an operation are updates.
 */
export function propertyRows(model: Model | null, draft: PropertyDraft): PropertyRow[] {
  if (!model) return []
  const names = model.properties.map((property) => property.name)
  for (const change of Object.values(draft)) {
    if (
      change.modelId === model.id &&
      change.operation === 'add' &&
      !names.includes(change.propertyName)
    )
      names.push(change.propertyName)
  }
  return names.map((name) => {
    const pending = draft[cellKey(model.id, name)]
    const property = model.properties.find((item) => item.name === name)
    return {
      name,
      value: pending
        ? pending.operation === 'delete'
          ? pending.oldValue
          : pending.newValue
        : property!.value,
    }
  })
}

/** Conservative Unicode caseless guard matching the worker's Python casefold rejection. */
const caseless = (value: string) => value.toUpperCase().toLowerCase()

function nameError(raw: string) {
  return !raw.trim() || raw.includes('\u0000') || raw.length > 255
    ? '属性名须为1–255个字符，不能包含空字符。'
    : undefined
}

function protectionReason(
  model: Model,
  property: Model['properties'][number] | undefined,
  capabilities?: Pick<Capabilities, 'writable'> | null,
  locked = false,
) {
  return locked
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
}

/**
 * Pure staging only; never mutates the model, draft, or Change objects and performs
 * no CAD calls. Request names are trimmed, then matched exactly (case-sensitive).
 * Case variants of snapshot/draft names are rejected to match worker safety rules.
 * Blank/NUL names and names over 255 UTF-16 code units are rejected. Add/update
 * require a string value, including ''. Missing/unknown capabilities fail closed.
 *
 * Add never overwrites, including pending deletes/adds. Update edits a pending add
 * in place or restores a pending delete; returning to original oldValue cancels an
 * update/delete. Delete cancels pending adds. Original oldValue survives every other
 * transition. All protections apply even to cancellation. No-ops count as skipped.
 */
export function stageProperty(
  model: Model | null,
  draft: PropertyDraft,
  request: PropertyOperation,
  capabilities?: Pick<Capabilities, 'writable'> | null,
  locked = false,
): StagePropertyResult {
  const result: StagePropertyResult = { draft: { ...draft }, affected: 0, skipped: 0, reasons: [] }
  const name = request.name.trim()
  // Case-insensitive collisions are rejected here as well as by the worker.
  const invalid =
    nameError(request.name) ??
    (!['add', 'update', 'delete'].includes(request.operation)
        ? '属性操作无效。'
        : request.operation !== 'delete' && typeof request.value !== 'string'
          ? '新增或修改必须提供文本值。'
          : undefined
      )
  if (invalid) {
    if (model) {
      result.skipped = 1
      result.reasons = [`${model.name}：${invalid}`]
    } else result.reasons = [invalid]
    return result
  }
  if (!model) return result
  const skip = (reason: string) => {
    result.skipped++
    result.reasons.push(`${model.name}：${reason}`)
  }
  const key = cellKey(model.id, name)
  const property = model.properties.find((item) => item.name === name)
  const pending = draft[key]
  const protection = protectionReason(model, property, capabilities, locked)
  if (protection) {
    skip(protection)
    return result
  }
  const collides =
    model.properties.some(
      (item) => item.name !== name && caseless(item.name) === caseless(name),
    ) ||
    Object.values(draft).some(
      (entry) =>
        entry.modelId === model.id &&
        entry.propertyName !== name &&
        caseless(entry.propertyName) === caseless(name),
    )
  if (collides) {
    skip('存在大小写同名属性，请使用原属性名。')
    return result
  }
  const exists = !!property || pending?.operation === 'add'
  let next: Change | undefined
  if (request.operation === 'add') {
    if (exists) {
      skip('属性名已存在。')
      return result
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
      return result
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
    skip('属性不存在。')
    return result
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
    return result
  }
  if (next) result.draft[key] = next
  else delete result.draft[key]
  result.affected++
  return result
}

/**
 * Renames a property while keeping its (possibly edited) value. Existing properties
 * are staged as exact delete(old) + add(new), so the submit preview never hides the
 * underlying CAD operations. Pending additions are renamed in place. Case variants,
 * read-only properties, and existing target names are rejected; target collisions
 * with any pending change are rejected too. No CAD calls are made.
 */
export function renameProperty(
  model: Model | null,
  draft: PropertyDraft,
  oldName: string,
  newNameRaw: string,
  value: string,
  capabilities?: Pick<Capabilities, 'writable'> | null,
  locked = false,
): StagePropertyResult {
  const result: StagePropertyResult = { draft: { ...draft }, affected: 0, skipped: 0, reasons: [] }
  const newName = newNameRaw.trim()
  const invalid = nameError(newNameRaw)
  if (invalid) {
    if (model) {
      result.skipped = 1
      result.reasons = [`${model.name}：${invalid}`]
    } else result.reasons = [invalid]
    return result
  }
  if (!model) return result
  const skip = (reason: string) => {
    result.skipped++
    result.reasons.push(`${model.name}：${reason}`)
  }
  const isSameName = oldName === newName
  const key = cellKey(model.id, oldName)
  const property = model.properties.find((item) => item.name === oldName)
  const pending = draft[key]
  const protection = protectionReason(model, property, capabilities, locked)
  if (protection) {
    skip(protection)
    return result
  }
  if (isSameName)
    return stageProperty(
      model,
      draft,
      { operation: 'update', name: oldName, value },
      capabilities,
      locked,
    )
  if (!property && pending?.operation !== 'add') {
    skip('属性不存在。')
    return result
  }
  const collides =
    model.properties.some((item) => caseless(item.name) === caseless(newName)) ||
    Object.values(draft).some(
      (entry) => entry.modelId === model.id && caseless(entry.propertyName) === caseless(newName),
    )
  if (collides) {
    skip('新属性名已存在，改名会覆盖其他属性。')
    return result
  }
  if (pending?.operation === 'delete') {
    skip('属性已标记删除，请先撤销再改名。')
    return result
  }
  const nextDraft = { ...draft }
  delete nextDraft[key]
  if (pending?.operation === 'add') {
    nextDraft[cellKey(model.id, newName)] = {
      ...pending,
      propertyName: newName,
      newValue: value,
    }
    result.draft = nextDraft
    result.affected = 1
    return result
  }
  nextDraft[key] = {
    modelId: model.id,
    propertyName: oldName,
    operation: 'delete',
    oldValue: pending?.oldValue ?? property!.value,
    newValue: '',
  }
  nextDraft[cellKey(model.id, newName)] = {
    modelId: model.id,
    propertyName: newName,
    operation: 'add',
    oldValue: '',
    newValue: value,
  }
  result.draft = nextDraft
  result.affected = 2
  return result
}
