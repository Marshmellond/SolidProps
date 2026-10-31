import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Trash2, X, RefreshCw, Undo2 } from 'lucide-react'
import type { Capabilities, Change, Snapshot } from '../types'
import { aggregatePropertyRows, stageProperty } from '../property-editor'
import { FileSidebar } from './FileSidebar'

type Draft = Record<string, Change>
interface Props {
  snapshot: Snapshot
  selected: ReadonlySet<string>
  onSelectionChange: (ids: Set<string>) => void
  draft: Draft
  onDraftChange: (draft: Draft) => void
  capabilities: Capabilities | null
  editing: boolean
  busy: boolean
  needsRefresh: boolean
  onRefresh: () => void
}
export function PropertyWorkbench(props: Props) {
  const {
    snapshot,
    selected,
    onSelectionChange,
    draft,
    onDraftChange,
    editing,
    busy,
    needsRefresh,
    capabilities,
  } = props
  const models = snapshot.models.filter((m) => selected.has(m.id))
  const rows = useMemo(() => aggregatePropertyRows(models, draft), [snapshot, selected, draft])
  const [query, setQuery] = useState('')
  const [valueTouched, setValueTouched] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [commonOnly, setCommonOnly] = useState(false)
  const [message, setMessage] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [action, setAction] = useState<{
    operation: 'update' | 'delete'
    names: string[]
    value: string
    fillMissing: boolean
  } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; name: string | null } | null>(null)
  const selectionKey = [...selected].sort().join('\u0000')
  useEffect(() => {
    setChecked(new Set())
    setAdding(false)
    setAction(null)
    setMenu(null)
    setMessage('')
  }, [selectionKey, snapshot.id, editing])
  const locked = !editing || busy || needsRefresh || !capabilities?.writable
  const canOperate = !locked && models.some((m) => m.writable && !m.dirty)
  const visibleRows = rows.filter(
    (row) =>
      (!commonOnly || row.present === models.length) &&
      (!query ||
        `${row.name} ${models.map((m) => draft[`${m.id}\u0000${row.name}`]?.newValue ?? m.properties.find((p) => p.name === row.name)?.value ?? '').join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  )
  const dirtyIds = new Set(Object.values(draft).map((c) => c.modelId))
  function stage(
    operation: 'add' | 'update' | 'delete',
    names: string[],
    value = '',
    fillMissing = false,
  ) {
    if (!canOperate) return
    let next = draft
    let affected = 0
    let skipped = 0
    const reasons: string[] = []
    try {
      for (const name of names) {
        const result = stageProperty(
          models,
          next,
          { operation, name, value, fillMissing },
          capabilities,
          locked,
        )
        next = result.draft
        affected += result.affected
        skipped += result.skipped
        reasons.push(...result.reasons)
      }
      onDraftChange(next)
      if (models.length > 1 || operation !== 'update')
        setMessage(
          `已暂存 ${affected} 项，跳过 ${skipped} 项${reasons.length ? `；${[...new Set(reasons)].slice(0, 3).join('；')}${reasons.length > 3 ? '；详细原因请在操作预览中核对' : ''}` : ''}`,
        )
      setAction(null)
      setAdding(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  function openUpdate(name?: string) {
    const target = name ?? [...checked][0] ?? rows[0]?.name
    if (!target || !canOperate) return
    const row = rows.find((r) => r.name === target)
    setValueTouched(false)
    setAction({
      operation: 'update',
      names: [target],
      value: row?.mixed ? '' : (row?.value ?? ''),
      fillMissing: false,
    })
  }
  function undo(name: string) {
    if (locked) return
    const next = { ...draft }
    for (const model of models) delete next[`${model.id}\u0000${name}`]
    onDraftChange(next)
    setMessage('已撤销所选文件中此属性的本地修改。')
  }
  const preview = (() => {
    if (!action) return null
    try {
      let next = draft
      let affected = 0
      let skipped = 0
      const reasons: string[] = []
      for (const name of action.names) {
        const result = stageProperty(models, next, { ...action, name }, capabilities, locked)
        next = result.draft
        affected += result.affected
        skipped += result.skipped
        reasons.push(...result.reasons)
      }
      return { affected, skipped, reasons: [...new Set(reasons)] }
    } catch {
      return null
    }
  })()
  const addPreview = (() => {
    if (!adding || !newName.trim()) return null
    try {
      return stageProperty(
        models,
        draft,
        { operation: 'add', name: newName, value: newValue },
        capabilities,
        locked,
      )
    } catch {
      return null
    }
  })()
  return (
    <div className="workbench redesigned-workbench">
      <FileSidebar
        snapshot={snapshot}
        selected={selected}
        onSelectionChange={onSelectionChange}
        dirtyModelIds={dirtyIds}
        disabled={busy}
      />
      <section className="property-panel">
        <div className="property-panel-heading">
          <div>
            <h2>
              {models.length === 1
                ? models[0].name
                : models.length
                  ? `已选 ${models.length} 个文件`
                  : '文档属性'}
            </h2>
            {models.length === 1 && <p title={models[0].path}>{models[0].path}</p>}
            {models.length > 1 && (
              <details>
                <summary>查看选中文件</summary>
                {models.map((m) => (
                  <p key={m.id} title={m.path}>
                    {m.name} · {m.path}
                  </p>
                ))}
              </details>
            )}
          </div>
          <button className="button" disabled={busy} onClick={props.onRefresh}>
            <RefreshCw size={14} />
            重新读取
          </button>
        </div>
        {needsRefresh && (
          <div className="property-warning" role="alert">
            读取状态已失效，请先重新读取，暂不能编辑或提交。
          </div>
        )}
        {models.some((m) => !m.writable || m.dirty) && (
          <details className="property-warning">
            <summary>
              {models.filter((m) => !m.writable || m.dirty).length} 个文件暂不可写，批量操作将跳过
            </summary>
            {models
              .filter((m) => !m.writable || m.dirty)
              .map((m) => (
                <p key={m.id}>
                  {m.name}：
                  {m.reason || (m.dirty ? 'CAD 中有未保存修改，请自行处理后重新读取' : '只读')}
                </p>
              ))}
          </details>
        )}
        <div className="property-toolbar">
          <label className="search-field">
            <Search size={14} />
            <input
              aria-label="查询属性"
              placeholder="查询属性名称或属性值"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="清空属性查询" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </label>
          {models.length > 1 && (
            <label className="common-property-toggle">
              <input
                type="checkbox"
                checked={commonOnly}
                onChange={(e) => setCommonOnly(e.target.checked)}
              />
              仅共同属性
            </label>
          )}
          <button
            className="button"
            disabled={!canOperate || !rows.length}
            onClick={() => openUpdate()}
          >
            {models.length > 1 ? '批量编辑' : '修改属性'}
          </button>
          <button
            className="button"
            disabled={!canOperate}
            onClick={() => {
              setAdding(true)
              setNewName('')
              setNewValue('')
            }}
          >
            <Plus size={14} />
            新增属性
          </button>
          <button
            className="button"
            disabled={!canOperate || !checked.size}
            onClick={() =>
              setAction({ operation: 'delete', names: [...checked], value: '', fillMissing: false })
            }
          >
            <Trash2 size={14} />
            删除属性{checked.size ? ` (${checked.size})` : ''}
          </button>
        </div>
        {message && (
          <div className="property-feedback" role="status">
            <span>{message}</span>
            <button aria-label="关闭操作提示" onClick={() => setMessage('')}>
              <X size={13} />
            </button>
          </div>
        )}
        <div
          className="property-list-scroll"
          onContextMenu={(e) => {
            if (!(e.target as HTMLElement).closest('tr')) {
              e.preventDefault()
              setMenu({
                x: Math.max(0, Math.min(e.clientX, window.innerWidth - 235)),
                y: Math.max(0, Math.min(e.clientY, window.innerHeight - 270)),
                name: null,
              })
            }
          }}
        >
          {!models.length ? (
            <div className="property-empty">从左侧选择文件查看属性。</div>
          ) : (
            <table className="vertical-properties">
              <thead>
                <tr>
                  <th className="property-check">
                    <input
                      type="checkbox"
                      aria-label="选择当前显示的全部属性"
                      checked={
                        visibleRows.length > 0 && visibleRows.every((r) => checked.has(r.name))
                      }
                      onChange={(e) =>
                        setChecked((prev) => {
                          const next = new Set(prev)
                          visibleRows.forEach((r) =>
                            e.target.checked ? next.add(r.name) : next.delete(r.name),
                          )
                          return next
                        })
                      }
                    />
                  </th>
                  <th>属性名称</th>
                  <th>属性值</th>
                  {models.length > 1 && <th className="coverage-col">存在于</th>}
                  <th className="property-change-col">本地变更</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const pending = models
                    .map((m) => draft[`${m.id}\u0000${row.name}`])
                    .filter(Boolean)
                  const deleted =
                    pending.length === models.length &&
                    pending.every((c) => c.operation === 'delete')
                  const writable =
                    canOperate &&
                    models.some(
                      (m) =>
                        m.writable &&
                        !m.dirty &&
                        (draft[`${m.id}\u0000${row.name}`]?.operation === 'add' ||
                          m.properties.some((p) => p.name === row.name && p.writable)),
                    )
                  return (
                    <tr
                      key={row.name}
                      className={pending.length ? 'property-row-pending' : ''}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setMenu({
                          x: Math.max(0, Math.min(e.clientX, window.innerWidth - 235)),
                          y: Math.max(0, Math.min(e.clientY, window.innerHeight - 270)),
                          name: row.name,
                        })
                      }}
                    >
                      <td className="property-check">
                        <input
                          type="checkbox"
                          aria-label={`选择属性 ${row.name}`}
                          checked={checked.has(row.name)}
                          onChange={(e) =>
                            setChecked((prev) => {
                              const next = new Set(prev)
                              e.target.checked ? next.add(row.name) : next.delete(row.name)
                              return next
                            })
                          }
                        />
                      </td>
                      <td className="property-name-cell" title={row.name}>
                        {row.name}
                      </td>
                      <td>
                        {models.length === 1 ? (
                          <SingleValue
                            value={deleted ? '（待删除）' : row.value}
                            disabled={!writable || deleted}
                            onCommit={(value) => stage('update', [row.name], value)}
                            name={row.name}
                            resetKey={`${snapshot.id}-${selectionKey}-${editing}`}
                          />
                        ) : (
                          <button
                            className={`aggregate-value ${row.mixed ? 'mixed-value' : ''}`}
                            disabled={!writable || deleted}
                            onClick={() => openUpdate(row.name)}
                          >
                            {deleted
                              ? '（待删除）'
                              : row.mixed
                                ? '多个不同值'
                                : row.value || '（空）'}
                          </button>
                        )}
                      </td>
                      {models.length > 1 && (
                        <td className="coverage-col">
                          {row.present} / {models.length} 个文件
                        </td>
                      )}
                      <td className="property-change-col">
                        {pending.length ? (
                          <>
                            <span>
                              {pending.some((c) => c.operation === 'add') ? '待新增 ' : ''}
                              {pending.some((c) => !c.operation || c.operation === 'update')
                                ? '待修改 '
                                : ''}
                              {pending.some((c) => c.operation === 'delete') ? '待删除' : ''}
                            </span>
                            <button
                              title="撤销此属性的本地修改"
                              aria-label={`撤销 ${row.name}`}
                              disabled={locked}
                              onClick={() => undo(row.name)}
                            >
                              <Undo2 size={13} />
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {models.length > 0 && !visibleRows.length && (
            <div className="property-empty">
              {rows.length ? '没有符合查询条件的属性。' : '暂无文档属性，进入编辑后可新增。'}
            </div>
          )}
          {adding && (
            <div className="inline-property-add">
              <h3>新增到 {models.length} 个选中文件</h3>
              <label>
                属性名称
                <input
                  aria-label="新增属性名称"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={255}
                />
              </label>
              <label>
                属性值
                <input
                  aria-label="新增属性值"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </label>
              <p>
                {addPreview
                  ? `预计新增 ${addPreview.affected} 项，跳过 ${addPreview.skipped} 项。${addPreview.reasons.join('；')}`
                  : '已有同名属性不覆盖，仅新增普通文本属性。'}
              </p>
              <div>
                <button className="button" onClick={() => setAdding(false)}>
                  取消
                </button>
                <button
                  className="button primary"
                  disabled={!canOperate || !addPreview?.affected}
                  onClick={() => stage('add', [newName], newValue)}
                >
                  加入编辑
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="property-panel-footer">
          <span>
            {models.length} 个选中文件 · {rows.length} 项属性
          </span>
          <span>{editing ? '编辑中' : '只读'} · 文档属性</span>
        </div>
        {snapshot.warnings.length > 0 && (
          <details className="warning-strip">
            <summary>读取详情</summary>
            <span>{snapshot.warnings.join(' · ')}</span>
          </details>
        )}
      </section>
      {action && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={action.operation === 'delete' ? '删除属性' : '批量编辑属性'}
          >
            <div className="modal-header">
              <h2>{action.operation === 'delete' ? '删除属性' : '批量编辑属性'}</h2>
              <button aria-label="关闭属性操作" onClick={() => setAction(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-fields">
              <p>作用于 {models.length} 个选中文件</p>
              {action.operation === 'update' ? (
                <>
                  <label>
                    目标属性
                    <select
                      value={action.names[0]}
                      onChange={(e) => {
                        const row = rows.find((r) => r.name === e.target.value)
                        setValueTouched(false)
                        setAction({
                          ...action,
                          names: [e.target.value],
                          value: row?.mixed ? '' : (row?.value ?? ''),
                          fillMissing: false,
                        })
                      }}
                    >
                      {rows.map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    统一赋值
                    <input
                      aria-label="批量属性值"
                      autoFocus
                      value={action.value}
                      onChange={(e) => {
                        setValueTouched(true)
                        setAction({ ...action, value: e.target.value })
                      }}
                      placeholder="输入新值；要清空请点下方清空按钮"
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => {
                      setValueTouched(true)
                      setAction({ ...action, value: '' })
                    }}
                  >
                    明确清空属性值
                  </button>
                  <fieldset className="missing-policy">
                    <legend>缺少属性的文件</legend>
                    <label>
                      <input
                        type="radio"
                        name="missing-policy"
                        checked={!action.fillMissing}
                        onChange={() => setAction({ ...action, fillMissing: false })}
                      />
                      仅修改已有属性（默认）
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="missing-policy"
                        checked={action.fillMissing}
                        onChange={() => setAction({ ...action, fillMissing: true })}
                      />
                      修改已有属性，并为缺少的文件新增
                    </label>
                  </fieldset>
                </>
              ) : (
                <p>将删除：{action.names.join('、')}。缺少属性的文件跳过，待新增项直接撤销。</p>
              )}
              <div className="operation-preview">
                预计处理 {preview?.affected ?? 0} 项，跳过 {preview?.skipped ?? 0} 项。
                <p>{preview?.reasons.join('；')}</p>
                <small>仅暂存本地变更，保存后仍需提交才写入 CAD。</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="button" onClick={() => setAction(null)}>
                取消
              </button>
              <button
                className="button primary"
                disabled={
                  !canOperate ||
                  !preview?.affected ||
                  (action.operation === 'update' &&
                    rows.find((r) => r.name === action.names[0])?.mixed &&
                    !valueTouched)
                }
                onClick={() =>
                  stage(action.operation, action.names, action.value, action.fillMissing)
                }
              >
                加入编辑
              </button>
            </div>
          </section>
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.name && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard?.writeText(menu.name!)
                  setMenu(null)
                }}
              >
                复制属性名
              </button>
              <button
                role="menuitem"
                disabled={!!rows.find((r) => r.name === menu.name)?.mixed}
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    rows.find((r) => r.name === menu.name)?.value ?? '',
                  )
                  setMenu(null)
                }}
              >
                复制属性值
              </button>
              <hr />
              <button
                role="menuitem"
                disabled={!canOperate}
                onClick={() => {
                  openUpdate(menu.name!)
                  setMenu(null)
                }}
              >
                修改此属性
              </button>
              <button
                role="menuitem"
                disabled={!canOperate}
                onClick={() => {
                  setAction({
                    operation: 'delete',
                    names: [menu.name!],
                    value: '',
                    fillMissing: false,
                  })
                  setMenu(null)
                }}
              >
                {models.length > 1 ? '删除所选文件中的此属性' : '删除此属性'}
              </button>
              <button
                role="menuitem"
                disabled={locked || !models.some((m) => draft[`${m.id}\u0000${menu.name}`])}
                onClick={() => {
                  undo(menu.name!)
                  setMenu(null)
                }}
              >
                撤销此项修改
              </button>
            </>
          )}
          <button
            role="menuitem"
            disabled={!canOperate}
            onClick={() => {
              setAdding(true)
              setNewName('')
              setNewValue('')
              setMenu(null)
            }}
          >
            新增属性
          </button>
        </ContextMenu>
      )}
    </div>
  )
}
function SingleValue({
  value,
  disabled,
  onCommit,
  name,
  resetKey,
}: {
  value: string
  disabled: boolean
  onCommit: (value: string) => void
  name: string
  resetKey: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value, resetKey])
  return (
    <input
      className="single-property-value"
      aria-label={`属性值 ${name}`}
      readOnly={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onCommit(e.target.value)
      }}
    />
  )
}
function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number
  y: number
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="context-dismiss" onMouseDown={onClose}>
      <div
        className="cell-context-menu"
        role="menu"
        aria-label="属性快捷操作"
        style={{ left: x, top: y }}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
