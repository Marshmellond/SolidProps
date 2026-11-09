import { useMemo, useState } from 'react'
import type { Model, Snapshot } from '../types'

export interface FileSidebarProps {
  snapshot: Snapshot
  selected: string | null
  onSelectionChange: (selected: string | null) => void
  dirtyModelIds?: ReadonlySet<string>
  disabled?: boolean
}

export interface FileSidebarEntry {
  model: Model
  isRoot: boolean
  referenceCount: number
  duplicateName: boolean
  parentDirectory: string
}

/** IDs already identify full paths; never merge distinct files just because names match. */
export function buildFileSidebarEntries(snapshot: Snapshot): FileSidebarEntry[] {
  const models = [...new Map(snapshot.models.map((model) => [model.id, model])).values()]
  const names = new Map<string, number>()
  const references = new Map<string, number>()
  for (const model of models) names.set(model.name, (names.get(model.name) ?? 0) + 1)
  const visit = (node: Snapshot['root']) => {
    if (node.modelId !== null) {
      references.set(node.modelId, (references.get(node.modelId) ?? 0) + 1)
    }
    node.children.forEach(visit)
  }
  // The document root is not an assembly reference to itself.
  snapshot.root.children.forEach(visit)
  return models
    .map((model) => ({
      model,
      isRoot: model.id === snapshot.root.modelId,
      referenceCount: references.get(model.id) ?? 0,
      duplicateName: (names.get(model.name) ?? 0) > 1,
      parentDirectory: model.path.replace(/[\\/][^\\/]*$/, ''),
    }))
    .sort(
      (a, b) =>
        Number(b.isRoot) - Number(a.isRoot) ||
        a.model.name.localeCompare(b.model.name, 'zh') ||
        a.model.path.localeCompare(b.model.path, 'zh') ||
        a.model.id.localeCompare(b.model.id, 'zh'),
    )
}

export function filterFileSidebarEntries(entries: FileSidebarEntry[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return entries.filter(
    ({ model }) =>
      model.name.toLocaleLowerCase().includes(needle) ||
      model.path.toLocaleLowerCase().includes(needle),
  )
}

export function FileSidebar({
  snapshot,
  selected,
  onSelectionChange,
  dirtyModelIds,
  disabled = false,
}: FileSidebarProps) {
  const [fileQuery, setFileQuery] = useState('')
  const entries = useMemo(() => buildFileSidebarEntries(snapshot), [snapshot])
  const visible = useMemo(() => filterFileSidebarEntries(entries, fileQuery), [entries, fileQuery])
  return (
    <aside className="file-sidebar" aria-label="模型文件">
      <label className="file-sidebar-search">
        <span className="file-sidebar-search-label">搜索文件</span>
        <input
          type="search"
          aria-label="搜索文件名或路径"
          placeholder="搜索文件名或路径"
          value={fileQuery}
          onChange={(event) => setFileQuery(event.target.value)}
        />
      </label>
      <div className="file-sidebar-panel">
        <ul className="file-sidebar-list" aria-label="模型文件">
          {visible.map(({ model, isRoot, referenceCount, duplicateName, parentDirectory }) => {
            const isSelected = selected === model.id
            return (
              <li key={model.id} className="file-sidebar-row">
                <button
                  type="button"
                  className={`file-sidebar-file${isSelected ? ' file-sidebar-row-selected' : ''}`}
                  title={model.path}
                  aria-label={`选择文件 ${model.name}（${model.path}）`}
                  aria-current={isSelected ? 'true' : undefined}
                  disabled={disabled}
                  onClick={() => onSelectionChange(model.id)}
                >
                  <span className="file-sidebar-main">
                    <span className="file-sidebar-name">{model.name}</span>
                    {duplicateName && (
                      <span className="file-sidebar-directory">{parentDirectory}</span>
                    )}
                  </span>
                  {isRoot && <span className="file-sidebar-root">根文件</span>}
                  {referenceCount > 1 && (
                    <span
                      className="file-sidebar-references"
                      aria-label={`装配引用 ${referenceCount} 次`}
                    >
                      ×{referenceCount}
                    </span>
                  )}
                  {dirtyModelIds?.has(model.id) && (
                    <span
                      className="file-sidebar-dirty"
                      title="有待提交变更"
                      aria-label="有待提交变更"
                    >
                      ●
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        {visible.length === 0 && (
          <p className="file-sidebar-empty">
            {entries.length ? '没有匹配的文件' : '没有可用文件'}
          </p>
        )}
      </div>
    </aside>
  )
}
