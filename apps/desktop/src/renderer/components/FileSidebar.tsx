import { useEffect, useId, useMemo, useState } from 'react'
import type { Model, Snapshot } from '../types'
import { AssemblyTree } from './AssemblyTree'

export interface FileSidebarProps {
  snapshot: Snapshot
  selected: ReadonlySet<string>
  onSelectionChange: (selected: Set<string>) => void
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

/** Change only the supplied IDs, preserving selections hidden by the current search. */
export function setFileSidebarSelection(
  selected: ReadonlySet<string>,
  ids: Iterable<string>,
  checked: boolean,
): Set<string> {
  const next = new Set(selected)
  for (const id of ids) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}

/** Files own batch selection; the occurrence tree only locates one underlying file. */
export function FileSidebar({
  snapshot,
  selected,
  onSelectionChange,
  dirtyModelIds,
  disabled = false,
}: FileSidebarProps) {
  const [view, setView] = useState<'files' | 'structure'>('files')
  const [fileQuery, setFileQuery] = useState('')
  const [structureQuery, setStructureQuery] = useState('')
  const [focusedOccurrence, setFocusedOccurrence] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())
  const id = useId()
  const entries = useMemo(() => buildFileSidebarEntries(snapshot), [snapshot])
  const modelIds = useMemo(() => new Set(entries.map(({ model }) => model.id)), [entries])
  const occurrenceModels = useMemo(() => {
    const models = new Map<string, string | null>()
    const visit = (node: Snapshot['root']) => {
      models.set(node.id, node.modelId)
      node.children.forEach(visit)
    }
    visit(snapshot.root)
    return models
  }, [snapshot.root])
  const visible = useMemo(() => filterFileSidebarEntries(entries, fileQuery), [entries, fileQuery])
  const visibleIds = useMemo(() => new Set(visible.map(({ model }) => model.id)), [visible])
  const hiddenIds = useMemo(
    () =>
      entries
        .filter(({ model }) => selected.has(model.id) && !visibleIds.has(model.id))
        .map(({ model }) => model.id),
    [entries, selected, visibleIds],
  )
  const selectedCount = useMemo(
    () => entries.filter(({ model }) => selected.has(model.id)).length,
    [entries, selected],
  )
  const visibleSelectedCount = useMemo(
    () => visible.filter(({ model }) => selected.has(model.id)).length,
    [visible, selected],
  )
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length
  const focusedModelId = selected.size === 1 ? [...selected][0] : null
  const validFocusedOccurrence =
    focusedOccurrence !== null &&
    focusedModelId !== null &&
    modelIds.has(focusedModelId) &&
    occurrenceModels.get(focusedOccurrence) === focusedModelId
      ? focusedOccurrence
      : null
  // A file selection or refreshed snapshot must not retain an unrelated occurrence highlight.
  useEffect(() => {
    if (focusedOccurrence !== validFocusedOccurrence) setFocusedOccurrence(null)
  }, [focusedOccurrence, validFocusedOccurrence])
  const changeFileSelection = (next: Set<string>) => {
    setFocusedOccurrence(null)
    onSelectionChange(next)
  }

  return (
    <aside className="file-sidebar" aria-label="模型文件与装配结构">
      <div className="file-sidebar-tabs" role="tablist" aria-label="浏览方式">
        {(['files', 'structure'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${id}-${tab}-tab`}
            aria-controls={`${id}-panel`}
            aria-selected={view === tab}
            className={`file-sidebar-tab${view === tab ? ' file-sidebar-tab-active' : ''}`}
            onClick={() => setView(tab)}
          >
            {tab === 'files' ? '文件' : '装配结构'}
          </button>
        ))}
      </div>
      <label className="file-sidebar-search">
        <span className="file-sidebar-search-label">
          搜索{view === 'files' ? '文件' : '装配结构'}
        </span>
        <input
          type="search"
          aria-label={view === 'files' ? '搜索文件名或路径' : '搜索装配结构'}
          placeholder={view === 'files' ? '搜索文件名或路径' : '搜索装配结构'}
          value={view === 'files' ? fileQuery : structureQuery}
          onChange={(event) =>
            (view === 'files' ? setFileQuery : setStructureQuery)(event.target.value)
          }
        />
      </label>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${view}-tab`}
        className="file-sidebar-panel"
      >
        {view === 'files' ? (
          <>
            <div className="file-sidebar-actions">
              <label className="file-sidebar-select-all">
                <input
                  type="checkbox"
                  aria-label="全选当前可见文件"
                  aria-checked={
                    visibleSelectedCount > 0 && !allVisibleSelected ? 'mixed' : allVisibleSelected
                  }
                  ref={(input) => {
                    if (input) input.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected
                  }}
                  checked={allVisibleSelected}
                  disabled={disabled || visible.length === 0}
                  onChange={(event) =>
                    changeFileSelection(
                      setFileSidebarSelection(selected, visibleIds, event.target.checked),
                    )
                  }
                />
                全选可见 ({visible.length})
              </label>
              <button
                type="button"
                disabled={disabled || selected.size === 0}
                onClick={() => changeFileSelection(new Set())}
              >
                清空选择
              </button>
            </div>
            <p className="file-sidebar-summary" role="status">
              已选 {selectedCount} / {entries.length} 个文件
            </p>
            {hiddenIds.length > 0 && (
              <div className="file-sidebar-hidden-selection">
                <span>搜索隐藏了 {hiddenIds.length} 个已选文件</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`清除 ${hiddenIds.length} 个隐藏文件的选择`}
                  onClick={() =>
                    changeFileSelection(setFileSidebarSelection(selected, hiddenIds, false))
                  }
                >
                  清除隐藏选择
                </button>
              </div>
            )}
            <ul className="file-sidebar-list" aria-label="模型文件">
              {visible.map(({ model, isRoot, referenceCount, duplicateName, parentDirectory }) => (
                <li
                  key={model.id}
                  className={`file-sidebar-row${selected.has(model.id) ? ' file-sidebar-row-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择文件 ${model.name}（${model.path}）`}
                    checked={selected.has(model.id)}
                    disabled={disabled}
                    onChange={(event) =>
                      changeFileSelection(
                        setFileSidebarSelection(selected, [model.id], event.target.checked),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="file-sidebar-file"
                    title={model.path}
                    aria-label={`仅选择文件 ${model.name}（${model.path}）`}
                    disabled={disabled}
                    onClick={() => changeFileSelection(new Set([model.id]))}
                  >
                    <span className="file-sidebar-name">{model.name}</span>
                    {duplicateName && (
                      <span className="file-sidebar-directory">{parentDirectory}</span>
                    )}
                  </button>
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
                </li>
              ))}
            </ul>
            {visible.length === 0 && (
              <p className="file-sidebar-empty">
                {entries.length ? '没有匹配的文件' : '没有可用文件'}
              </p>
            )}
          </>
        ) : (
          <>
            <fieldset className="file-sidebar-tree" disabled={disabled} aria-label="装配结构定位">
              <AssemblyTree
                root={snapshot.root}
                query={structureQuery.trim()}
                focusedModelId={focusedModelId}
                focusedOccurrenceId={validFocusedOccurrence}
                collapsedIds={collapsedIds}
                onToggle={(occurrenceId) => {
                  if (!disabled)
                    setCollapsedIds(
                      setFileSidebarSelection(
                        collapsedIds,
                        [occurrenceId],
                        !collapsedIds.has(occurrenceId),
                      ),
                    )
                }}
                onLocate={(modelId, occurrenceId) => {
                  if (disabled || modelId === null || !modelIds.has(modelId)) return
                  setFocusedOccurrence(occurrenceId ?? null)
                  onSelectionChange(new Set([modelId]))
                }}
              />
            </fieldset>
          </>
        )}
      </div>
    </aside>
  )
}
