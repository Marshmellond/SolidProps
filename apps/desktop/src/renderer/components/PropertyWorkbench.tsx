import { useEffect, useMemo, useRef, useState } from 'react'
import { LockKeyhole, Plus, Search, Trash2, Undo2, X, RotateCcw, Redo2, Check, Boxes } from 'lucide-react'
import type { Capabilities, Change, Snapshot } from '../types'
import { propertyRows, renameProperty, stageProperty } from '../property-editor'
import { FileSidebar } from './FileSidebar'

type Draft = Record<string, Change>
interface Props {
  snapshot: Snapshot
  selected: string | null
  onSelectionChange: (id: string | null) => void
  draft: Draft
  onDraftChange: (draft: Draft) => void
  capabilities: Capabilities | null
  editing: boolean
  busy: boolean
  needsRefresh: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onUndoAll: () => void
  onEdit: () => void
  onShowAssembly?: () => void
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
    canUndo,
    canRedo,
  } = props
  const model = useMemo(
    () => snapshot.models.find((item) => item.id === selected) ?? null,
    [snapshot.models, selected],
  )
  const rows = useMemo(() => propertyRows(model, draft), [model, draft])
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [newRows, setNewRows] = useState<{ id: number; name: string; value: string }[]>([])
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const newRowId = useRef(0)
  const [deleting, setDeleting] = useState<{ names: string[] } | null>(null)
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; name: string | null } | null>(null)
  useEffect(() => {
    setChecked(new Set())
    setNewRows([])
    setRowErrors({})
    setDeleting(null)
    setNotice(null)
    setMenu(null)
    setMessage('')
  }, [selected, snapshot.id, editing])
  const locked = !editing || busy || needsRefresh || !capabilities?.writable
  const canOperate = !locked && !!model && model.writable && !model.dirty
  const visibleRows = rows.filter(
    (row) =>
      !query ||
      `${row.name} ${row.value}`.toLowerCase().includes(query.toLowerCase()),
  )
  const dirtyIds = new Set(Object.values(draft).map((change) => change.modelId))
  const hasDraft = Object.keys(draft).length > 0
  function stage(operation: 'add' | 'update' | 'delete', names: string[], value = '') {
    if (!canOperate) return 0
    let next = draft
    let affected = 0
    const reasons: string[] = []
    try {
      for (const name of names) {
        const result = stageProperty(
          model,
          next,
          { operation, name, value },
          capabilities,
          locked,
        )
        next = result.draft
        affected += result.affected
        reasons.push(...result.reasons)
      }
      onDraftChange(next)
      if (operation !== 'update') {
        const details = [...new Set(reasons)].slice(0, 3)
        setMessage(
          affected
            ? `已暂存 ${affected} 项${details.length ? `；${details.join('；')}` : ''}`
            : details.join('；') || '未暂存任何项。',
        )
      }
      setDeleting(null)
      return affected
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return 0
    }
  }
  function updateNewRow(id: number, patch: Partial<{ name: string; value: string }>) {
    setNewRows((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    if (patch.name !== undefined)
      setRowErrors((errors) => {
        if (!(id in errors)) return errors
        const next = { ...errors }
        delete next[id]
        return next
      })
  }
  function commitNewRow(id: number) {
    if (!model || !canOperate) return
    const row = newRows.find((item) => item.id === id)
    if (!row) return
    const name = row.name.trim()
    if (!name) {
      setRowErrors((errors) => ({ ...errors, [id]: '请先填写属性名称。' }))
      return
    }
    const result = stageProperty(model, draft, { operation: 'add', name, value: row.value }, capabilities, locked)
    if (result.affected > 0) {
      onDraftChange(result.draft)
      setMessage('已暂存 1 项')
      setNewRows((items) => items.filter((item) => item.id !== id))
      setRowErrors((errors) => {
        const next = { ...errors }
        delete next[id]
        return next
      })
      return
    }
    const reason = result.reasons[0]?.replace(/^.*?：/, '') || '新增未生效。'
    setRowErrors((errors) => ({ ...errors, [id]: reason }))
    setMessage(reason)
    setNotice(
      reason.includes('已存在')
        ? { title: '属性名已存在', detail: '' }
        : { title: '无法新增', detail: reason },
    )
  }
  function cancelNewRow(id: number) {
    setNewRows((items) => items.filter((item) => item.id !== id))
    setRowErrors((errors) => {
      const next = { ...errors }
      delete next[id]
      return next
    })
  }
  function rename(rowName: string, nextName: string) {
    if (!canOperate || nextName === rowName) return false
    const row = rows.find((item) => item.name === rowName)
    const result = renameProperty(
      model,
      draft,
      rowName,
      nextName,
      row?.value ?? '',
      capabilities,
      locked,
    )
    if (result.affected) {
      onDraftChange(result.draft)
      setMessage(
        `已暂存 ${result.affected} 项${result.reasons.length ? `；${result.reasons.slice(0, 3).join('；')}` : ''}`,
      )
      return true
    }
    setMessage(result.reasons[0] || '改名未生效。')
    return false
  }
  function undo(name: string) {
    if (locked) return
    const next = { ...draft }
    delete next[`${model!.id}\u0000${name}`]
    onDraftChange(next)
    setMessage('已撤销此属性的本地修改。')
  }
  const deletePreview = (() => {
    if (!deleting) return null
    try {
      let next = draft
      let affected = 0
      let skipped = 0
      const reasons: string[] = []
      for (const name of deleting.names) {
        const result = stageProperty(
          model,
          next,
          { operation: 'delete', name, value: '' },
          capabilities,
          locked,
        )
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
            <h2 title={model?.path}>{model ? model.name : '文档属性'}</h2>
          </div>
          {props.onShowAssembly && (
            <button className="topbar-button" disabled={busy} onClick={props.onShowAssembly}>
              <Boxes size={15} />
              装配结构
            </button>
          )}
        </div>
        {needsRefresh && !busy && (
          <div className="property-warning" role="alert">
            读取状态已失效，请到连接页重新连接。
          </div>
        )}
        {model && (!model.writable || model.dirty) && (
          <div className="property-warning">
            <strong>当前文件不可写</strong>
            <p>{model.reason || (model.dirty ? 'CAD 中有未保存修改，请自行处理后重新连接' : '只读')}</p>
          </div>
        )}
        {!editing && model && (
          <div className="readonly-banner" role="status">
            <LockKeyhole size={16} />
            <span className="readonly-title">只读查看</span>
            <button
              className="button primary"
              data-testid="edit-properties"
              disabled={busy || needsRefresh || !capabilities?.writable || !model.writable || model.dirty}
              onClick={props.onEdit}
            >
              编辑
            </button>
          </div>
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
          <button
            className="button"
            disabled={!canOperate}
            onClick={() =>
              setNewRows((items) => [...items, { id: ++newRowId.current, name: '', value: '' }])
            }
          >
            <Plus size={14} />
            新增属性
          </button>
          <button
            className="button"
            disabled={!canOperate || !checked.size}
            onClick={() => setDeleting({ names: [...checked] })}
          >
            <Trash2 size={14} />
            删除属性{checked.size ? ` (${checked.size})` : ''}
          </button>
          {editing && (
            <div className="undo-group">
              <button
                className="button"
                disabled={!canUndo || busy}
                onClick={props.onUndo}
                title="撤销上一步编辑"
              >
                <Undo2 size={14} />
                撤销上一步
              </button>
              <button
                className="button"
                disabled={!canRedo || busy}
                onClick={props.onRedo}
                title="重做上一步撤销"
              >
                <Redo2 size={14} />
                重做上一步
              </button>
              <button
                className="button"
                disabled={!hasDraft || busy}
                onClick={props.onUndoAll}
                title="清除所有待提交修改，不会修改 CAD 文件"
              >
                <RotateCcw size={14} />
                撤回全部
              </button>
            </div>
          )}
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
          {!model ? (
            <div className="property-empty">未选择文件</div>
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
                  <th className="property-change-col">状态</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const pending = draft[`${model.id}\u0000${row.name}`]
                  const deleted = pending?.operation === 'delete'
                  const property = model.properties.find((item) => item.name === row.name)
                  const writable =
                    canOperate && (pending?.operation === 'add' || !!property?.writable)
                  return (
                    <tr
                      key={row.name}
                      className={pending ? 'property-row-pending' : ''}
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
                        <SingleName
                          value={row.name}
                          disabled={!writable || deleted}
                          onCommit={(value) => rename(row.name, value)}
                          resetKey={`${snapshot.id}-${selected ?? ''}-${editing}`}
                        />
                      </td>
                      <td>
                        <SingleValue
                          value={deleted ? '（待删除）' : row.value}
                          disabled={!writable || deleted}
                          onCommit={(value) => stage('update', [row.name], value)}
                          name={row.name}
                          resetKey={`${snapshot.id}-${selected ?? ''}-${editing}`}
                        />
                      </td>
                      <td className="property-change-col">
                        {pending ? (
                          <>
                            <span
                              title={
                                pending.operation === 'add'
                                  ? '新增'
                                  : pending.operation === 'delete'
                                    ? '删除'
                                    : '修改'
                              }
                            >
                              待提交
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
                {newRows.map((row) => (
                  <tr
                    key={row.id}
                    className={rowErrors[row.id] ? 'property-row-new has-error' : 'property-row-new'}
                  >
                    <td className="property-check" />
                    <td className="property-name-cell">
                      <input
                        className="single-property-name"
                        aria-label="新增属性名称"
                        aria-invalid={rowErrors[row.id] ? true : undefined}
                        placeholder="属性名称"
                        autoFocus={row.id === newRows[newRows.length - 1].id}
                        value={row.name}
                        maxLength={255}
                        onChange={(e) => updateNewRow(row.id, { name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitNewRow(row.id)
                          } else if (e.key === 'Escape') cancelNewRow(row.id)
                        }}
                      />
                      {rowErrors[row.id] && (
                        <span className="row-error" role="alert">
                          {rowErrors[row.id]}
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        className="single-property-value"
                        aria-label="新增属性值"
                        placeholder="属性值"
                        value={row.value}
                        onChange={(e) => updateNewRow(row.id, { value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitNewRow(row.id)
                          } else if (e.key === 'Escape') cancelNewRow(row.id)
                        }}
                      />
                    </td>
                    <td className="property-change-col property-row-new-actions">
                      <button
                        title={row.name.trim() ? '确认新增' : '填写属性名称后可确认'}
                        aria-label="确认新增"
                        disabled={!row.name.trim()}
                        onClick={() => commitNewRow(row.id)}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        title="取消新增"
                        aria-label="取消新增"
                        onClick={() => cancelNewRow(row.id)}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {model && !visibleRows.length && !newRows.length && (
            <div className="property-empty">
              {rows.length ? '没有符合查询条件的属性。' : '暂无文档属性'}
            </div>
          )}
        </div>
        <div className="property-panel-footer">
          <span>{rows.length} 项属性</span>
          {editing && <span>编辑中</span>}
        </div>
      </section>
      {notice && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label={notice.title}>
            <div className="modal-header">
              <h2>{notice.title}</h2>
              <button aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X size={18} />
              </button>
            </div>
            {notice.detail && (
              <div className="modal-fields">
                <p>{notice.detail}</p>
              </div>
            )}
            <div className="modal-footer">
              <button className="button primary" onClick={() => setNotice(null)}>
                知道了
              </button>
            </div>
          </section>
        </div>
      )}
      {deleting && (
        <div className="modal-backdrop">
          <section className="modal danger-modal" role="dialog" aria-modal="true" aria-label="删除属性">
            <div className="modal-header danger-header">
              <div className="danger-heading">
                <span className="danger-icon">
                  <Trash2 size={18} />
                </span>
                <div>
                  <h2>删除属性</h2>
                  <p>以下 {deleting.names.length} 项属性将从当前文件移除</p>
                </div>
              </div>
              <button aria-label="关闭属性操作" onClick={() => setDeleting(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="danger-body">
              <div className="danger-chips">
                {deleting.names.map((name) => (
                  <span className="danger-chip" key={name}>
                    {name}
                  </span>
                ))}
              </div>
              {deletePreview?.reasons.length ? <p className="danger-note">{deletePreview.reasons.join('；')}</p> : null}
            </div>
            <div className="modal-footer">
              <button className="button" onClick={() => setDeleting(null)}>
                取消
              </button>
              <button
                className="button danger"
                disabled={!canOperate || !deletePreview?.affected}
                onClick={() => stage('delete', deleting.names)}
              >
                删除
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
                  setDeleting({ names: [menu.name!] })
                  setMenu(null)
                }}
              >
                删除此属性
              </button>
              <button
                role="menuitem"
                disabled={locked || !draft[`${model?.id ?? ''}\u0000${menu.name}`]}
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
              setNewRows((items) => [...items, { id: ++newRowId.current, name: '', value: '' }])
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
function SingleName({
  value,
  disabled,
  onCommit,
  resetKey,
}: {
  value: string
  disabled: boolean
  onCommit: (value: string) => boolean
  resetKey: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value, resetKey])
  if (disabled)
    return (
      <span className="property-display-name" title={value}>
        {value}
      </span>
    )
  const commit = () => {
    const next = text.trim()
    if (next === value) return setText(value)
    if (!onCommit(next)) setText(value)
  }
  return (
    <input
      className="single-property-name"
      aria-label={`属性名称 ${value}`}
      value={text}
      maxLength={255}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setText(value)
      }}
    />
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
  if (disabled)
    return (
      <span className="property-display-value" aria-label={`属性值 ${name}`}>
        {value || '（空）'}
      </span>
    )
  return (
    <input
      className="single-property-value"
      aria-label={`属性值 ${name}`}
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
