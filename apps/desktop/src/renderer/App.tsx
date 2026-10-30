import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Boxes,
  Check,
  ChevronDown,
  ClipboardPaste,
  FileClock,
  FolderTree,
  Info,
  LayoutGrid,
  Link2,
  Loader2,
  LockKeyhole,
  Square,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type {
  ApplyResult,
  Bridge,
  Capabilities,
  Change,
  Diagnostic,
  Model,
  Operation,
  Occurrence,
  Page,
  Session,
  Snapshot,
} from './types'
import { exportText, request } from './bridge'
import { AssemblyTree } from './components/AssemblyTree'
import { ConnectionPage } from './components/ConnectionPage'
import { EditActions } from './components/EditActions'
import { canEdit, rectangularPaste, updateDraft } from './editing'
import { draftKey, draftEntries, draftSignature, restoreDraft, type SavedDraft } from './drafts'

async function local<T>(method: string, params: unknown = {}): Promise<T> {
  if (!window.cadweave?.local) throw new Error('请使用更新后的桌面应用。')
  return window.cadweave.local(method, params) as Promise<T>
}

declare global {
  interface Window {
    cadweave?: Bridge & {
      exportFile?: (options: {
        suggestedName: string
        content: string
      }) => Promise<{ path?: string; cancelled: boolean }>
      windowControl?: (action: 'minimize' | 'maximize' | 'close') => void
    }
  }
}
const nav = [
  { id: 'workspace', label: '工作台', icon: LayoutGrid },
  { id: 'connections', label: '连接', icon: Link2 },
  { id: 'history', label: '记录', icon: FileClock },
] as const
function countInstances(root: Occurrence): number {
  return root.children.reduce((count, child) => count + 1 + countInstances(child), 0)
}
const keyOf = (m: string, p: string) => `${m}\u0000${p}`
function errorText(e: unknown) {
  return e instanceof Error
    ? e.message
    : typeof e === 'object' && e && 'message' in e
      ? String(e.message)
      : String(e)
}
function IconButton({
  children,
  title,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  title: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      className="icon-button"
      aria-label={title}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  )
}
export default function App() {
  const [page, setPage] = useState<Page>('connections')
  const [sessions, setSessions] = useState<Session[]>([]),
    [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [session, setSession] = useState<Session | null>(null),
    [cap, setCap] = useState<Capabilities | null>(null),
    [snap, setSnap] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(''),
    [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const [propertyTargetId, setPropertyTargetId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    modelId: string
    property: string
  } | null>(null)
  const [focusedOccurrence, setFocusedOccurrence] = useState<string | null>(null)
  const [savedSignature, setSavedSignature] = useState('[]')
  const [savedAt, setSavedAt] = useState('')
  const [draftConflicts, setDraftConflicts] = useState(0)
  const [propertyAction, setPropertyAction] = useState<'add' | 'delete' | null>(null)
  const [newPropertyName, setNewPropertyName] = useState('')
  const [newPropertyValue, setNewPropertyValue] = useState('')
  const [draft, setDraft] = useState<Record<string, Change>>({}),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState(''),
    [treeSearch, setTreeSearch] = useState(''),
    [focusedModel, setFocusedModel] = useState<string | null>(null),
    [onlyDirty, setOnlyDirty] = useState(false)
  const [detail, setDetail] = useState(false),
    [activeCell, setActiveCell] = useState<{
      modelId: string
      property: string
    } | null>(null)
  const [modal, setModal] = useState<'preview' | 'batch' | null>(null),
    [confirmation, setConfirmation] = useState<{
      title: string
      text: string
      action: () => void
    } | null>(null)
  const [batchProp, setBatchProp] = useState(''),
    [batchValue, setBatchValue] = useState('')
  const [logs, setLogs] = useState<Operation[]>([])
  const [needsRefresh, setNeedsRefresh] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const booted = useRef(false)
  const changes = Object.values(draft)
  const [historyOffset, setHistoryOffset] = useState(0)
  async function loadHistory(offset = 0) {
    const rows = await local<(Omit<Operation, 'status'> & { status: string })[]>('history.list', {
      limit: 200,
      offset,
    })
    setHistoryOffset(offset)
    setLogs(
      rows.map((row) => ({
        ...row,
        status:
          row.status === 'success'
            ? 'success'
            : row.status === 'failure' || row.status === 'error'
              ? 'error'
              : 'warning',
      })),
    )
  }
  const log = (title: string, text: string, status: Operation['status'] = 'success') => {
    void local('history.append', {
      title,
      detail: text,
      status: status === 'success' ? 'success' : status === 'error' ? 'failure' : 'info',
    })
      .then(() => loadHistory())
      .catch((e) => setNotice({ text: `记录保存失败：${errorText(e)}`, error: true }))
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      const text = errorText(e)
      setNotice({ text, error: true })
      log(label, text, 'error')
    } finally {
      setBusy('')
    }
  }
  async function discover() {
    await run('发现 CAD 会话', async () => {
      const r = await request<{
        sessions: Session[]
        diagnostics: Diagnostic[]
      }>('discover')
      setSessions(r.sessions)
      setDiagnostics(r.diagnostics)
      log('发现 CAD 会话', `发现 ${r.sessions.length} 个会话`)
    })
  }
  useEffect(() => {
    if (!booted.current) {
      booted.current = true
      void discover()
    }
  }, [])
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (draftSignature(draft) !== savedSignature) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [draft, savedSignature])
  function guard(title: string, action: () => void) {
    if (draftSignature(draft) !== savedSignature)
      setConfirmation({
        title,
        text: `有 ${changes.length} 项修改尚未保存为草稿，继续将丢弃未保存的修改。`,
        action: () => {
          setDraft({})
          action()
        },
      })
    else action()
  }
  async function loadSavedDraft(data: Snapshot) {
    setDraft({})
    setSavedSignature('[]')
    setSavedAt('')
    setDraftConflicts(0)
    const saved = await local<SavedDraft | null>('draft.load', draftKey(data))
    if (!saved) return
    const restored = restoreDraft(data, saved)
    setDraft(restored.changes)
    setSavedAt(saved.savedAt)
    setDraftConflicts(restored.conflicts.length)
    if (!restored.conflicts.length) setSavedSignature(draftSignature(restored.changes))
    else
      setNotice({
        text: `${restored.conflicts.length} 项草稿与当前模型冲突，未载入这些项；请检查记录和当前属性后重新编辑并保存。`,
        error: true,
      })
  }
  async function saveDraft() {
    if (!snap || busy || needsRefresh) return
    await run('保存草稿', async () => {
      let saved = { savedAt: '' }
      if (changes.length)
        saved = await local<{ savedAt: string }>('draft.save', {
          ...draftKey(snap),
          entries: draftEntries(snap, changes),
        })
      else await local('draft.delete', draftKey(snap))
      setSavedSignature(draftSignature(draft))
      setSavedAt(saved.savedAt)
      setDraftConflicts(0)
      setEditing(false)
      await local('history.append', {
        title: '保存草稿',
        detail: `${snap.title} · ${changes.length} 项变更（未写入 CAD）`,
        status: 'success',
        changes: draftEntries(snap, changes).map((c) => ({
          ...c,
          modelName: snap.models.find((m) => m.path === c.modelPath)?.name ?? '',
          success: null,
          saved: false,
          message: '已保存本地草稿，尚未提交',
        })),
      })
      await loadHistory()
    })
  }
  function connect(s: Session) {
    guard('切换连接？', () => {
      void run('连接会话', async () => {
        const c = await request<{
          session: Session
          capabilities: Capabilities
        }>('connect', { sessionId: s.id })
        setSession(c.session)
        setCap(c.capabilities)
        setSnap(null)
        setEditing(false)
        setDraft({})
        setNeedsRefresh(false)
        setCollapsed(new Set())
        setSelected(new Set())
        const data = await request<Snapshot>('snapshot', { scope: 'document' })
        setSnap(data)
        await loadSavedDraft(data)
        setPage('workspace')
        setFocusedModel(null)
        setFocusedOccurrence(null)
        log('连接会话', `${s.label} · ${data.models.length} 个模型`)
      })
    })
  }
  function refresh() {
    const scope = 'document'
    guard('重新读取快照？', () => {
      void run('读取模型快照', async () => {
        setNeedsRefresh(true)
        setEditing(false)
        const data = await request<Snapshot>('snapshot', { scope })
        setSnap(data)
        setEditing(false)
        setDraft({})
        setSelected(new Set())
        setFocusedModel(null)
        setFocusedOccurrence(null)
        setNeedsRefresh(false)
        await loadSavedDraft(data)
        log('读取模型快照', `${data.title} · ${data.models.length} 个模型`)
      })
    })
  }
  const canStartEditing =
    !!cap?.writable && !needsRefresh && !!snap?.models.some((m) => m.writable && !m.dirty)
  function cancelEditing() {
    const cancel = () => {
      setEditing(false)
      setModal(null)
      setOnlyDirty(false)
      if (snap) void run('恢复草稿', () => loadSavedDraft(snap))
    }
    if (draftSignature(draft) !== savedSignature)
      setConfirmation({
        title: '取消本次编辑？',
        text: '将丢弃尚未保存的编辑，恢复上次草稿，不会修改 CAD 文件。',
        action: cancel,
      })
    else cancel()
  }
  function editable(m: Model, prop: string) {
    const change = draft[keyOf(m.id, prop)]
    return (
      editing &&
      !busy &&
      !needsRefresh &&
      change?.operation !== 'delete' &&
      (change?.operation === 'add'
        ? !!cap?.writable && m.writable && !m.dirty
        : canEdit(m, prop, cap, needsRefresh))
    )
  }
  function addMissingProperty(model: Model, name: string) {
    if (!editing || busy || needsRefresh || !cap?.writable || !model.writable || model.dirty) return
    setDraft((prev) => ({
      ...prev,
      [keyOf(model.id, name)]: {
        modelId: model.id,
        propertyName: name,
        operation: 'add',
        oldValue: '',
        newValue: '',
      },
    }))
  }
  function deleteCellProperty(model: Model, name: string) {
    if (!editing || busy || needsRefresh || !model.writable || model.dirty || !cap?.writable) return
    setDraft((prev) => {
      const next = { ...prev }
      const key = keyOf(model.id, name)
      if (next[key]?.operation === 'add') delete next[key]
      else {
        const prop = model.properties.find((p) => p.name === name)
        if (!prop || !prop.writable) return prev
        next[key] = {
          modelId: model.id,
          propertyName: name,
          operation: 'delete',
          oldValue: prop.value,
          newValue: '',
        }
      }
      return next
    })
  }
  function editValue(m: Model, name: string, value: string) {
    if (!editable(m, name)) return
    setDraft((prev) => updateDraft(prev, m, name, value))
  }
  const columns = useMemo(
    () => [
      ...new Set([
        ...(snap?.models.flatMap((m) => m.properties.map((p) => p.name)) ?? []),
        ...Object.values(draft).map((c) => c.propertyName),
      ]),
    ],
    [snap, draft],
  )
  const models = useMemo(
    () =>
      (snap?.models ?? []).filter(
        (m) =>
          (!focusedModel || m.id === focusedModel) &&
          (!search ||
            `${m.name} ${m.path} ${m.properties.map((p) => p.value).join(' ')}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!onlyDirty || changes.some((c) => c.modelId === m.id)),
      ),
    [snap, focusedModel, search, onlyDirty, draft],
  )
  const inspected =
    snap?.models.find((m) => m.id === activeCell?.modelId) ??
    snap?.models.find((m) => selected.has(m.id))
  const selectedModels = snap?.models.filter((m) => selected.has(m.id)) ?? []
  const batchColumns = columns.filter((name) => selectedModels.some((m) => editable(m, name)))
  const draftSaved =
    changes.length > 0 && savedSignature === draftSignature(draft) && !draftConflicts
  function startRowEdit(model: Model) {
    if (busy || needsRefresh || !cap?.writable || !model.writable || model.dirty) return
    setEditing(true)
  }
  function openPropertyAction(action: 'add' | 'delete', modelId: string | null) {
    if (!editing || busy || needsRefresh) return
    if (modelId) {
      const model = snap?.models.find((m) => m.id === modelId)
      if (!model || !model.writable || model.dirty) return
      startRowEdit(model)
    } else {
      setEditing(true)
    }
    setPropertyTargetId(modelId)
    setPropertyAction(action)
    setNewPropertyName('')
    setNewPropertyValue('')
  }
  function stagePropertyAction() {
    if (!editing || busy || needsRefresh || !propertyAction) return
    const name = newPropertyName.trim()
    if (!name || name.includes('\u0000')) {
      setNotice({ text: '请输入有效属性名', error: true })
      return
    }
    const targets = (
      propertyTargetId
        ? (snap?.models.filter((m) => m.id === propertyTargetId) ?? [])
        : selectedModels
    ).filter((m) => m.writable && !m.dirty)
    const next = { ...draft }
    let count = 0
    for (const m of targets) {
      const existing = m.properties.find((p) => p.name.toLowerCase() === name.toLowerCase())
      const pending = Object.values(next).find(
        (c) => c.modelId === m.id && c.propertyName.toLowerCase() === name.toLowerCase(),
      )
      if (propertyAction === 'add') {
        if (existing || pending) continue
        next[keyOf(m.id, name)] = {
          modelId: m.id,
          propertyName: name,
          operation: 'add',
          oldValue: '',
          newValue: newPropertyValue,
        }
        count++
      } else if (pending?.operation === 'add') {
        delete next[keyOf(m.id, pending.propertyName)]
        count++
      } else if (existing && canEdit(m, existing.name, cap, needsRefresh)) {
        next[keyOf(m.id, existing.name)] = {
          modelId: m.id,
          propertyName: existing.name,
          operation: 'delete',
          oldValue: existing.value,
          newValue: '',
        }
        count++
      }
    }
    setDraft(next)
    setPropertyAction(null)
    setNotice(
      count
        ? null
        : { text: '没有符合条件的属性，请检查选中模型、同名属性和只读状态。', error: true },
    )
  }
  async function apply() {
    if (busy || !snap || !draftSaved || needsRefresh) return
    setModal(null)
    setNeedsRefresh(true)
    setEditing(false)
    await run('提交属性', async () => {
      let outcome: ApplyResult | null = null
      let failure = ''
      try {
        outcome = await request<ApplyResult>('apply', {
          snapshotId: snap.id,
          changes,
          confirmSave: true,
        })
        const pending = changes.filter(
          (c) =>
            !outcome!.results.some(
              (r) =>
                r.modelId === c.modelId &&
                r.propertyName === c.propertyName &&
                r.success &&
                r.saved,
            ),
        )
        if (pending.length)
          await local('draft.save', { ...draftKey(snap), entries: draftEntries(snap, pending) })
        else await local('draft.delete', draftKey(snap))
      } catch (e) {
        failure = errorText(e)
      }
      // Re-read even when apply reports an exception: never infer CAD state from
      // the optimistic draft or silently retry an uncertain mutation.
      try {
        const data = await request<Snapshot>('snapshot', { scope: 'document' })
        setSnap(data)
        setNeedsRefresh(false)
        setSelected(new Set())
        setActiveCell(null)
        await loadSavedDraft(data)
      } catch (e) {
        setNeedsRefresh(true)
        failure += `${failure ? '；' : ''}自动读取失败：${errorText(e)}`
      }
      await loadHistory()
      const succeeded = outcome?.results.filter((r) => r.success && r.saved).length ?? 0
      const auditWarning = (outcome as (ApplyResult & { auditWarning?: string }) | null)
        ?.auditWarning
      setNotice({
        text:
          failure ||
          `${succeeded} 项成功，${changes.length - succeeded} 项未完成${auditWarning ? `；${auditWarning}` : ''}`,
        error: !!failure || succeeded !== changes.length || !!auditWarning,
      })
    })
  }
  async function exportReport() {
    await run('导出日志', async () => {
      const report = await local<{ suggestedName: string; content: string }>('history.export', {
        all: true,
      })
      if (window.cadweave?.exportFile) await window.cadweave.exportFile(report)
      else exportText(report.suggestedName, report.content, 'text/plain')
    })
  }
  function pasteRect(e: React.ClipboardEvent<HTMLInputElement>, m: Model, property: string) {
    if (!editable(m, property)) return
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const { cells, skipped } = rectangularPaste(
      text,
      models,
      columns,
      models.findIndex((v) => v.id === m.id),
      columns.indexOf(property),
      cap,
      needsRefresh,
      editable,
    )
    cells.forEach((c) => editValue(c.model, c.propertyName, c.value))
    setNotice({
      text: `已粘贴 ${cells.length} 个单元格${skipped ? `，跳过 ${skipped} 个只读或越界单元格` : ''}。尚未提交。`,
    })
  }
  return (
    <div className="app">
      <aside className="rail">
        <button className="brand-mark" title="CadWeave" onClick={() => setPage('workspace')}>
          <span>C</span>
          <i />
        </button>
        <div className="rail-nav">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              onClick={() => {
                setPage(n.id)
                if (n.id === 'history') void run('读取记录', loadHistory)
              }}
              title={n.label}
            >
              <n.icon size={21} />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="wordmark">
            CadWeave <span>CAD 属性工作台</span>
          </div>
          <div className="top-right">
            <span className={`connection-pill ${session ? 'online' : ''}`}>
              <i />
              {session ? session.label : '尚未连接 CAD'}
            </span>
            <div className="window-actions">
              {(['minimize', 'maximize', 'close'] as const).map((a, i) => (
                <button
                  key={a}
                  title={['最小化', '最大化', '关闭'][i]}
                  onClick={() => window.cadweave?.windowControl?.(a)}
                  disabled={!window.cadweave?.windowControl}
                >
                  {i === 0 ? <Minus size={14} /> : i === 1 ? <Square size={12} /> : <X size={15} />}
                </button>
              ))}
            </div>
          </div>
        </header>
        {notice && (
          <div className={`notice ${notice.error ? 'error' : ''}`} role="status">
            <Info size={15} />
            <span>{notice.text}</span>
            <IconButton title="关闭提示" onClick={() => setNotice(null)}>
              <X size={14} />
            </IconButton>
          </div>
        )}
        {page === 'workspace' ? (
          <>
            <div className="workspace-title">
              <div>
                <h1>属性工作台</h1>
              </div>
              <div className="title-actions">
                <EditActions
                  editing={editing}
                  canStart={canStartEditing}
                  busy={!!busy}
                  locked={needsRefresh}
                  changeCount={changes.length}
                  onStart={() => setEditing(true)}
                  onSave={() => void saveDraft()}
                  saved={draftSaved}
                  canSaveEmpty={!!savedAt}
                  onSubmit={() => setModal('preview')}
                  onCancel={cancelEditing}
                />
              </div>
            </div>
            {!snap ? (
              <Empty
                icon={<Boxes size={36} />}
                title="从连接一个 CAD 会话开始"
                text="请先发现并连接已打开的 CAD 会话，再读取当前模型。"
              >
                <button className="button primary" onClick={() => setPage('connections')}>
                  前往连接管理 <ArrowRight size={16} />
                </button>
              </Empty>
            ) : (
              <div className="workbench">
                <aside className="tree-panel">
                  <div className="panel-heading">
                    <span>
                      <FolderTree size={16} />
                      装配结构
                    </span>
                    <span className="count">{countInstances(snap.root)} 实例</span>
                  </div>
                  <label className="search-field tree-search">
                    <Search size={14} />
                    <input
                      placeholder="搜索、定位模型…"
                      value={treeSearch}
                      onChange={(e) => setTreeSearch(e.target.value)}
                    />
                  </label>
                  <div className="tree-tools">
                    <span>装配实例</span>
                    <button
                      title="显示所有模型"
                      onClick={() => {
                        setFocusedModel(null)
                        setFocusedOccurrence(null)
                        setTreeSearch('')
                      }}
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="tree-content">
                    <AssemblyTree
                      root={snap.root}
                      query={treeSearch}
                      focusedModelId={focusedModel}
                      focusedOccurrenceId={focusedOccurrence}
                      collapsedIds={collapsed}
                      onToggle={(id) =>
                        setCollapsed((prev) => {
                          const next = new Set(prev)
                          next.has(id) ? next.delete(id) : next.add(id)
                          return next
                        })
                      }
                      onLocate={(id, occurrenceId) => {
                        setFocusedOccurrence(occurrenceId ?? null)
                        setFocusedModel(id)
                        setSearch('')
                      }}
                    />
                  </div>
                  <div className="tree-footer">
                    <span>
                      <Boxes size={14} />
                      {snap.models.filter((m) => m.kind === 'assembly').length} 装配
                    </span>
                    <span>
                      <Box size={14} />
                      {snap.models.filter((m) => m.kind === 'part').length} 零件
                    </span>
                  </div>
                </aside>
                <section className="matrix-panel">
                  <div className="matrix-heading">
                    <div>
                      <h2>
                        模型文件属性 <span>{models.length} 个文件</span>
                      </h2>
                      <p>
                        {needsRefresh
                          ? '自动读取失败，请重新读取'
                          : editing
                            ? '编辑中'
                            : savedAt && changes.length
                              ? `草稿已保存 · ${new Date(savedAt).toLocaleString('zh-CN')}`
                              : ''}
                        {focusedModel && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setFocusedModel(null)
                              setFocusedOccurrence(null)
                            }}
                          >
                            显示全部
                          </button>
                        )}
                      </p>
                    </div>
                    <div className="matrix-heading-actions">
                      <span className="scope-label">文档属性</span>
                      <IconButton title="重新读取快照" onClick={() => refresh()} disabled={!!busy}>
                        <RefreshCw size={16} />
                      </IconButton>
                      <IconButton
                        title={detail ? '关闭详情' : '打开详情'}
                        onClick={() => setDetail(!detail)}
                      >
                        {detail ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
                      </IconButton>
                    </div>
                  </div>
                  <div className="matrix-toolbar">
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="搜索属性矩阵"
                        placeholder="搜索模型、编号或属性值"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button onClick={() => setSearch('')}>
                          <X size={13} />
                        </button>
                      )}
                    </label>
                    <button
                      className={`filter-button ${onlyDirty ? 'on' : ''}`}
                      onClick={() => setOnlyDirty(!onlyDirty)}
                    >
                      <SlidersHorizontal size={14} />
                      仅看修改
                      {changes.length > 0 && <span>{changes.length}</span>}
                    </button>
                    <div className="toolbar-divider" />
                    <button
                      className="plain-button"
                      disabled={
                        !editing ||
                        !selectedModels.some((m) => m.writable && !m.dirty) ||
                        !!busy ||
                        needsRefresh ||
                        !cap?.writable
                      }
                      onClick={() => {
                        setEditing(true)
                        setBatchProp(batchColumns[0] ?? columns[0] ?? '')
                        setBatchValue('')
                        setModal('batch')
                      }}
                    >
                      <ClipboardPaste size={15} />
                      批量修改
                    </button>
                    <button
                      className="plain-button"
                      disabled={
                        !editing ||
                        !selectedModels.some((m) => m.writable && !m.dirty) ||
                        !!busy ||
                        needsRefresh ||
                        !cap?.writable
                      }
                      onClick={() => openPropertyAction('add', null)}
                    >
                      <Plus size={15} />
                      新增属性
                    </button>
                    <button
                      className="plain-button"
                      disabled={
                        !editing ||
                        !selectedModels.some((m) => m.writable && !m.dirty) ||
                        !!busy ||
                        needsRefresh ||
                        !cap?.writable
                      }
                      onClick={() => openPropertyAction('delete', null)}
                    >
                      <Trash2 size={15} />
                      删除属性
                    </button>
                    <button
                      className="plain-button"
                      disabled={!changes.length || !!busy}
                      onClick={() =>
                        setConfirmation({
                          title: '撤销全部本地修改？',
                          text: `将恢复 ${changes.length} 项尚未提交的属性值。已提交的修改不会受到影响。`,
                          action: () => setDraft({}),
                        })
                      }
                    >
                      <Undo2 size={15} />
                      撤销
                    </button>
                  </div>
                  <div className="matrix-body">
                    <div className="table-scroll">
                      <table className="property-table" data-testid="matrix-table">
                        <thead>
                          <tr>
                            <th className="check-col">
                              <input
                                type="checkbox"
                                aria-label="选择当前显示的全部模型"
                                checked={
                                  models.length > 0 && models.every((m) => selected.has(m.id))
                                }
                                onChange={(e) =>
                                  setSelected((prev) => {
                                    const n = new Set(prev)
                                    models.forEach((m) =>
                                      e.target.checked ? n.add(m.id) : n.delete(m.id),
                                    )
                                    return n
                                  })
                                }
                              />
                            </th>
                            <th className="index-col">#</th>
                            <th className="model-col">
                              模型名称 <ChevronDown size={12} />
                            </th>
                            {columns.map((p) => (
                              <th key={p}>{p}</th>
                            ))}
                            <th className="state-col">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {models.map((m, i) => (
                            <tr key={m.id} className={selected.has(m.id) ? 'row-selected' : ''}>
                              <td className="check-col">
                                <input
                                  type="checkbox"
                                  aria-label={`选择 ${m.name}`}
                                  checked={selected.has(m.id)}
                                  onChange={(e) =>
                                    setSelected((prev) => {
                                      const n = new Set(prev)
                                      e.target.checked ? n.add(m.id) : n.delete(m.id)
                                      return n
                                    })
                                  }
                                />
                              </td>
                              <td className="index-col">{String(i + 1).padStart(2, '0')}</td>
                              <td className="model-col">
                                <button
                                  className="model-name"
                                  onClick={() => {
                                    setActiveCell({
                                      modelId: m.id,
                                      property: columns[0],
                                    })
                                    setDetail(true)
                                  }}
                                >
                                  {m.kind === 'assembly' ? <Boxes size={17} /> : <Box size={16} />}
                                  <span>{m.name}</span>
                                  {!m.writable && <LockKeyhole size={12} />}
                                </button>
                              </td>
                              {columns.map((name) => {
                                const c = draft[keyOf(m.id, name)],
                                  p =
                                    m.properties.find((p) => p.name === name) ??
                                    (c?.operation === 'add'
                                      ? { name, value: '', writable: true, reason: '' }
                                      : undefined),
                                  writable = editable(m, name)
                                return (
                                  <td
                                    key={name}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      setContextMenu({
                                        x: Math.min(e.clientX, window.innerWidth - 190),
                                        y: Math.min(e.clientY, window.innerHeight - 220),
                                        modelId: m.id,
                                        property: name,
                                      })
                                    }}
                                    className={`${c ? 'cell-dirty' : ''} ${!writable ? 'cell-readonly' : ''}`}
                                    title={
                                      c
                                        ? `原值：${p?.value || '（空）'}`
                                        : !editing && canEdit(m, name, cap, needsRefresh)
                                          ? '点击右上角“编辑”后修改'
                                          : !writable
                                            ? m.reason ||
                                              p?.reason ||
                                              (m.dirty
                                                ? '模型已有未保存修改，禁止保存'
                                                : '只读或无此属性')
                                            : ''
                                    }
                                  >
                                    {p ? (
                                      <input
                                        aria-label={`${m.name} · ${name}`}
                                        readOnly={!writable || !!busy}
                                        value={
                                          c?.operation === 'delete'
                                            ? '（待删除）'
                                            : (c?.newValue ?? p.value)
                                        }
                                        placeholder={writable ? '—' : ''}
                                        onFocus={() =>
                                          setActiveCell({
                                            modelId: m.id,
                                            property: name,
                                          })
                                        }
                                        onChange={(e) => editValue(m, name, e.target.value)}
                                        onPaste={(e) => pasteRect(e, m, name)}
                                      />
                                    ) : (
                                      <button
                                        className="missing-property"
                                        title={
                                          editing && m.writable && !m.dirty
                                            ? '为此文件新增同名属性，不影响其他文件'
                                            : '此文件没有该属性'
                                        }
                                        disabled={
                                          !editing ||
                                          !m.writable ||
                                          m.dirty ||
                                          !cap?.writable ||
                                          !!busy ||
                                          needsRefresh
                                        }
                                        onClick={() => {
                                          setSelected(new Set([m.id]))
                                          addMissingProperty(m, name)
                                        }}
                                      >
                                        未设置{editing && m.writable && !m.dirty ? ' +' : ''}
                                      </button>
                                    )}
                                    {c && <i className="dirty-corner" />}
                                  </td>
                                )
                              })}
                              <td className="state-col">
                                {changes.some((c) => c.modelId === m.id) ? (
                                  <span className="status modified">
                                    <i />
                                    已修改
                                  </span>
                                ) : !m.writable || m.dirty ? (
                                  <span className="status readonly">
                                    <LockKeyhole size={10} />
                                    {m.dirty ? 'CAD 有未保存修改' : '只读'}
                                  </span>
                                ) : needsRefresh ? (
                                  <span className="status readonly">待读取</span>
                                ) : (
                                  <span className="status synced">
                                    <i />
                                    已读取
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!models.length && (
                        <div className="table-empty">
                          没有匹配的模型
                          <button
                            className="text-button"
                            onClick={() => {
                              setSearch('')
                              setOnlyDirty(false)
                              setFocusedModel(null)
                              setFocusedOccurrence(null)
                            }}
                          >
                            清除筛选
                          </button>
                        </div>
                      )}
                    </div>
                    {detail && (
                      <aside className="detail-panel">
                        <div className="panel-heading">
                          模型详情
                          <IconButton title="关闭详情" onClick={() => setDetail(false)}>
                            <X size={15} />
                          </IconButton>
                        </div>
                        {inspected ? (
                          <>
                            <div className="detail-model">
                              <Box size={28} />
                              <h3>{inspected.name}</h3>
                              <span>
                                {inspected.kind === 'assembly' ? '装配体' : '零件'} ·{' '}
                                {inspected.configuration || '无配置'}
                              </span>
                            </div>
                            <dl>
                              <dt>文件路径</dt>
                              <dd>{inspected.path}</dd>
                              <dt>写入权限</dt>
                              <dd>
                                {inspected.writable && !inspected.dirty && cap?.writable
                                  ? '允许编辑既有属性'
                                  : inspected.reason || '只读 / 存在未保存修改'}
                              </dd>
                              <dt>属性作用域</dt>
                              <dd>文档属性</dd>
                              <dt>当前快照</dt>
                              <dd className="mono">{snap.id}</dd>
                            </dl>
                            {activeCell && (
                              <div className="field-info">
                                <strong>{activeCell.property}</strong>
                                <p>
                                  原始值：
                                  {inspected.properties.find((p) => p.name === activeCell.property)
                                    ?.value || '（空）'}
                                </p>
                                {draft[keyOf(inspected.id, activeCell.property)] && (
                                  <p className="modified-text">
                                    本地值：
                                    {draft[keyOf(inspected.id, activeCell.property)].newValue ||
                                      '（空）'}
                                  </p>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="muted pad">选择一个模型或属性单元格查看详情。</p>
                        )}
                      </aside>
                    )}
                  </div>
                  {needsRefresh && (
                    <div className="refresh-required">
                      <Info size={14} />
                      <span>
                        自动读取失败，请先检查 SolidWorks 状态，再重新读取。执行详情已保留在记录中。
                      </span>
                      <button className="text-button" onClick={() => refresh()}>
                        重新读取 <RefreshCw size={12} />
                      </button>
                    </div>
                  )}
                  <div className="matrix-footer">
                    <span>
                      共 {snap.models.length} 个模型 <i /> 已选 {selected.size} 个
                    </span>
                    {changes.length > 0 && <span>{changes.length} 项变更</span>}
                  </div>
                  {snap.warnings.length > 0 && (
                    <details className="warning-strip">
                      <summary>读取详情</summary>
                      <span>{snap.warnings.join(' · ')}</span>
                    </details>
                  )}
                </section>
              </div>
            )}
          </>
        ) : (
          <main className="page-content">
            <div className="page-title">
              <h1>{nav.find((n) => n.id === page)?.label}</h1>
            </div>
            {page === 'connections' && (
              <ConnectionPage
                sessions={sessions}
                diagnostics={diagnostics}
                session={session}
                capabilities={cap}
                busy={!!busy}
                onDiscover={() => void discover()}
                onConnect={connect}
                onDisconnect={() =>
                  guard('断开当前连接？', () => {
                    void run('断开连接', async () => {
                      await request('disconnect')
                      setSession(null)
                      setCap(null)
                      setSnap(null)
                      setEditing(false)
                      setDraft({})
                      if (session) log('断开连接', session.label)
                    })
                  })
                }
              />
            )}
            {page === 'history' && (
              <>
                <div className="section-toolbar">
                  <h2>
                    记录 <span className="count">{logs.length}</span>
                  </h2>
                  <button
                    className="button"
                    disabled={!logs.length}
                    onClick={() => void exportReport()}
                  >
                    <ArrowDownToLine size={15} />
                    导出日志
                  </button>
                  <button
                    className="button"
                    disabled={!!busy || historyOffset === 0}
                    onClick={() =>
                      void run('读取记录', () => loadHistory(Math.max(0, historyOffset - 200)))
                    }
                  >
                    上一页
                  </button>
                  <button
                    className="button"
                    disabled={!!busy || logs.length < 200}
                    onClick={() => void run('读取记录', () => loadHistory(historyOffset + 200))}
                  >
                    下一页
                  </button>
                </div>
                {!logs.length ? (
                  <Empty
                    icon={<FileClock size={34} />}
                    title="暂无操作记录"
                    text="发现、连接、读取、提交和导出操作发生后会显示在这里。"
                  />
                ) : (
                  <div className="history-list">
                    {logs.map((l) => (
                      <article key={l.id}>
                        <span className={`history-icon ${l.status}`}>
                          {l.status === 'success' ? <Check size={17} /> : <Info size={17} />}
                        </span>
                        <div>
                          <h3>
                            {l.title}
                            <span className={`tag ${l.status}`}>
                              {l.status === 'success'
                                ? '已完成'
                                : l.status === 'warning'
                                  ? '需关注'
                                  : '失败'}
                            </span>
                          </h3>
                          <p>{l.detail}</p>
                          {!!l.changes?.length && (
                            <details className="record-details">
                              <summary>查看 {l.changes.length} 项变更</summary>
                              {l.changes.map((c, i) => (
                                <div className="record-change" key={i}>
                                  <strong>
                                    {c.modelName || c.modelPath} · {c.propertyName} ·{' '}
                                    {c.operation === 'add'
                                      ? '新增'
                                      : c.operation === 'delete'
                                        ? '删除'
                                        : '修改'}
                                  </strong>
                                  <small>{c.modelPath}</small>
                                  <p>
                                    原值：
                                    {c.operation === 'add' ? '（不存在）' : c.oldValue || '（空）'}
                                  </p>
                                  <p>
                                    新值：
                                    {c.operation === 'delete' ? '（删除）' : c.newValue || '（空）'}
                                  </p>
                                  <p>
                                    {c.success === null ? '状态未知' : c.success ? '成功' : '失败'}{' '}
                                    ·{' '}
                                    {c.saved === null
                                      ? '保存状态未知'
                                      : c.saved
                                        ? '已写入文件'
                                        : '未保存文件'}{' '}
                                    · {c.message}
                                  </p>
                                </div>
                              ))}
                            </details>
                          )}
                        </div>
                        <time>{new Date(l.time).toLocaleString('zh-CN', { hour12: false })}</time>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        )}
        <footer className="app-status">
          <span>
            <span className={session ? 'online-dot' : 'offline-dot'} />
            {busy ||
              (session ? `${cap?.displayName ?? session.label} · 文档属性` : '就绪 · 请选择连接')}
          </span>
          <span>
            {snap ? `${snap.models.length} 模型 · ${columns.length} 属性列` : ''}
            <i />
            CadWeave 0.1
          </span>
        </footer>
      </div>
      {busy && (
        <div className="busy-indicator" role="status">
          <Loader2 size={17} className="spin" />
          {busy}…
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop">
          <section
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label={confirmation.title}
          >
            <div className="modal-header">
              <h2>{confirmation.title}</h2>
              <IconButton title="关闭" onClick={() => setConfirmation(null)}>
                <X size={18} />
              </IconButton>
            </div>
            <p className="confirm-text">{confirmation.text}</p>
            <div className="modal-footer">
              <button className="button" onClick={() => setConfirmation(null)}>
                取消
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const action = confirmation.action
                  setConfirmation(null)
                  action()
                }}
              >
                确认
              </button>
            </div>
          </section>
        </div>
      )}
      {contextMenu &&
        (() => {
          const model = snap?.models.find((m) => m.id === contextMenu.modelId)
          if (!model) return null
          const prop = model.properties.find((p) => p.name === contextMenu.property)
          const pending = draft[keyOf(model.id, contextMenu.property)]
          const locked =
            !editing || !!busy || needsRefresh || !model.writable || model.dirty || !cap?.writable
          return (
            <div
              className="context-dismiss"
              onMouseDown={() => setContextMenu(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setContextMenu(null)
              }}
            >
              <div
                className="cell-context-menu"
                role="menu"
                aria-label="属性快捷操作"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <strong>{contextMenu.property}</strong>
                <button
                  role="menuitem"
                  disabled={locked}
                  onClick={() => {
                    setSelected(new Set([model.id]))
                    openPropertyAction('add', model.id)
                    setContextMenu(null)
                  }}
                >
                  新增属性
                </button>
                {!prop && !pending && (
                  <button
                    role="menuitem"
                    disabled={locked}
                    onClick={() => {
                      addMissingProperty(model, contextMenu.property)
                      setContextMenu(null)
                    }}
                  >
                    新增此属性
                  </button>
                )}
                <button
                  role="menuitem"
                  disabled={locked || (!prop?.writable && pending?.operation !== 'add')}
                  onClick={() => {
                    setSelected(new Set([model.id]))
                    deleteCellProperty(model, contextMenu.property)
                    setContextMenu(null)
                  }}
                >
                  删除此属性
                </button>
                <button
                  role="menuitem"
                  disabled={locked || !pending}
                  onClick={() => {
                    setDraft((prev) => {
                      const next = { ...prev }
                      delete next[keyOf(model.id, contextMenu.property)]
                      return next
                    })
                    setContextMenu(null)
                  }}
                >
                  撤销此项修改
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setActiveCell({ modelId: model.id, property: contextMenu.property })
                    setDetail(true)
                    setContextMenu(null)
                  }}
                >
                  查看详情
                </button>
              </div>
            </div>
          )
        })()}
      {propertyAction && (
        <div className="modal-backdrop">
          <div
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-label={propertyAction === 'add' ? '新增属性' : '删除属性'}
          >
            <div className="modal-header">
              <h2>{propertyAction === 'add' ? '新增属性' : '删除属性'}</h2>
              <IconButton title="关闭" onClick={() => setPropertyAction(null)}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="modal-fields">
              <label>
                属性名
                <input
                  value={newPropertyName}
                  onChange={(e) => setNewPropertyName(e.target.value)}
                  list="property-names"
                  autoFocus
                />
              </label>
              <datalist id="property-names">
                {columns.map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
              {propertyAction === 'add' && (
                <label>
                  属性值
                  <input
                    value={newPropertyValue}
                    onChange={(e) => setNewPropertyValue(e.target.value)}
                  />
                </label>
              )}
              <p>
                {propertyTargetId
                  ? snap?.models.find((m) => m.id === propertyTargetId)?.name
                  : `选中 ${selected.size} 个文件`}
                {propertyAction === 'delete' ? '，删除仅在提交后执行' : '，新增文本属性'}
              </p>
            </div>
            <div className="modal-footer">
              <button className="button" onClick={() => setPropertyAction(null)}>
                取消
              </button>
              <button
                className="button primary"
                disabled={!newPropertyName.trim() || !!busy}
                onClick={stagePropertyAction}
              >
                加入编辑
              </button>
            </div>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className={`modal ${modal === 'preview' ? 'preview-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'preview' ? '提交属性修改' : '批量赋值'}
          >
            <div className="modal-header">
              <div>
                <h2>{modal === 'preview' ? '提交属性修改' : '批量赋值'}</h2>
                <p>
                  {modal === 'preview'
                    ? `确认 ${changes.length} 项属性变更并写入 CAD 文档`
                    : `作用于 ${selectedModels.length} 个选中模型，仅修改既有可写属性`}
                </p>
              </div>
              <IconButton title="关闭弹窗" onClick={() => setModal(null)}>
                <X size={18} />
              </IconButton>
            </div>
            {modal === 'preview' && (
              <>
                <div className="submit-warning">
                  <Info size={16} />
                  <span>提交后将写入 SolidWorks 文件。</span>
                </div>
                <div className="preview-snapshot">
                  快照 ID <code>{snap?.id}</code>
                </div>
                <div className="preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>模型 / 属性</th>
                        <th>原值</th>
                        <th>新值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr key={keyOf(c.modelId, c.propertyName)}>
                          <td>
                            <strong>{snap?.models.find((m) => m.id === c.modelId)?.name}</strong>
                            <small>
                              {c.propertyName} ·{' '}
                              {c.operation === 'add'
                                ? '新增'
                                : c.operation === 'delete'
                                  ? '删除'
                                  : '修改'}
                            </small>
                          </td>
                          <td>{c.operation === 'add' ? '（不存在）' : c.oldValue || '（空）'}</td>
                          <td className="modified-text">
                            {c.operation === 'delete' ? '（删除）' : c.newValue || '（空）'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-footer">
                  <span />
                  <button className="button" onClick={() => setModal(null)}>
                    返回编辑
                  </button>
                  <button
                    className="button primary"
                    data-testid="apply-changes"
                    disabled={!!busy || needsRefresh || !draftSaved}
                    onClick={() => void apply()}
                  >
                    <Save size={15} />
                    确认提交
                  </button>
                </div>
              </>
            )}
            {modal === 'batch' && (
              <>
                <div className="modal-fields">
                  <label>
                    目标属性
                    <select value={batchProp} onChange={(e) => setBatchProp(e.target.value)}>
                      {batchColumns.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    统一赋值
                    <input
                      autoFocus
                      value={batchValue}
                      placeholder="输入属性值，留空将清空此属性"
                      onChange={(e) => setBatchValue(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    只读、缺少该属性或已有未保存修改的模型将跳过。不会新增属性。
                  </p>
                </div>
                <div className="modal-footer">
                  <button className="button" onClick={() => setModal(null)}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    disabled={!batchProp}
                    onClick={() => {
                      let count = 0
                      selectedModels.forEach((m) => {
                        if (editable(m, batchProp)) {
                          editValue(m, batchProp, batchValue)
                          count++
                        }
                      })
                      setModal(null)
                      setNotice({
                        text: `已向 ${count} 个模型赋值，跳过 ${selectedModels.length - count} 个不可写模型。修改尚未提交。`,
                      })
                    }}
                  >
                    应用到本地修改
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
