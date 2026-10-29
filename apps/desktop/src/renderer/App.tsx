import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  Boxes,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardPaste,
  FileClock,
  FileText,
  FolderTree,
  Info,
  Layers3,
  LayoutGrid,
  Link2,
  Loader2,
  LockKeyhole,
  Maximize2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
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
  Page,
  Session,
  Snapshot,
  Template,
} from './types'
import { exportText, request } from './bridge'
import { AssemblyTree } from './components/AssemblyTree'
import { ConnectionPage } from './components/ConnectionPage'
import { canEdit, rectangularPaste, updateDraft } from './editing'

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
  { id: 'templates', label: '属性模板', icon: Layers3 },
  { id: 'history', label: '操作记录', icon: FileClock },
  { id: 'connections', label: '连接管理', icon: Link2 },
  { id: 'settings', label: '偏好设置', icon: Settings2 },
] as const
const keyOf = (m: string, p: string) => `${m}\u0000${p}`
function stored<T>(key: string, initial: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? initial
  } catch {
    return initial
  }
}
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
  const [modal, setModal] = useState<'preview' | 'batch' | 'template' | null>(null),
    [confirmation, setConfirmation] = useState<{
      title: string
      text: string
      action: () => void
    } | null>(null)
  const [batchProp, setBatchProp] = useState(''),
    [batchValue, setBatchValue] = useState('')
  const [result, setResult] = useState<ApplyResult | null>(null),
    [logs, setLogs] = useState<Operation[]>([])
  const [needsRefresh, setNeedsRefresh] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState(() =>
    stored('cadweave.settings', {
      dense: false,
      showReadonly: true,
      showPaths: false,
    }),
  )
  const [templates, setTemplates] = useState<Template[]>(() => stored('cadweave.templates', []))
  const [templateName, setTemplateName] = useState('')
  const booted = useRef(false)
  const changes = Object.values(draft)
  const log = (title: string, text: string, status: Operation['status'] = 'success') =>
    setLogs((v) => [
      {
        id: crypto.randomUUID(),
        time: new Date().toLocaleString('zh-CN', { hour12: false }),
        title,
        detail: text,
        status,
      },
      ...v,
    ])
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
    localStorage.setItem('cadweave.settings', JSON.stringify(settings))
  }, [settings])
  useEffect(() => {
    localStorage.setItem('cadweave.templates', JSON.stringify(templates))
  }, [templates])
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(draft).length) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [draft])
  function guard(title: string, action: () => void) {
    if (changes.length)
      setConfirmation({
        title,
        text: `有 ${changes.length} 项未提交修改，继续将丢弃这些本地修改。`,
        action: () => {
          setDraft({})
          action()
        },
      })
    else action()
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
        setDraft({})
        setResult(null)
        setNeedsRefresh(false)
        setCollapsed(new Set())
        setSelected(new Set())
        const data = await request<Snapshot>('snapshot', { scope: 'document' })
        setSnap(data)
        setPage('workspace')
        setFocusedModel(null)
        log('连接会话', `${s.label} · ${data.models.length} 个模型`)
      })
    })
  }
  function refresh(scope = snap?.scope ?? 'document') {
    guard('重新读取快照？', () => {
      void run('读取模型快照', async () => {
        const data = await request<Snapshot>('snapshot', { scope })
        setSnap(data)
        setDraft({})
        setSelected(new Set())
        setFocusedModel(null)
        setNeedsRefresh(false)
        log('读取模型快照', `${data.title} · ${data.models.length} 个模型`)
      })
    })
  }
  function editable(m: Model, prop: string) {
    return canEdit(m, prop, cap, needsRefresh)
  }
  function editValue(m: Model, name: string, value: string) {
    if (!editable(m, name)) return
    setDraft((prev) => updateDraft(prev, m, name, value))
  }
  const columns = useMemo(
    () => [...new Set(snap?.models.flatMap((m) => m.properties.map((p) => p.name)) ?? [])],
    [snap],
  )
  const models = useMemo(
    () =>
      (snap?.models ?? []).filter(
        (m) =>
          (!focusedModel || m.id === focusedModel) &&
          (settings.showReadonly || m.writable) &&
          (!search ||
            `${m.name} ${m.path} ${m.properties.map((p) => p.value).join(' ')}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!onlyDirty || changes.some((c) => c.modelId === m.id)),
      ),
    [snap, focusedModel, settings.showReadonly, search, onlyDirty, draft],
  )
  const inspected =
    snap?.models.find((m) => m.id === activeCell?.modelId) ??
    snap?.models.find((m) => selected.has(m.id))
  const selectedModels = snap?.models.filter((m) => selected.has(m.id)) ?? []
  const batchColumns = columns.filter((name) => selectedModels.some((m) => editable(m, name)))
  async function apply() {
    if (!snap || !changes.length || needsRefresh) return
    setModal(null)
    setNeedsRefresh(true)
    await run('提交并保存', async () => {
      const r = await request<ApplyResult>('apply', {
        snapshotId: snap.id,
        changes,
        confirmSave: true,
      })
      setResult(r)
      const ok = r.results.filter((v) => v.success).length
      log(
        '提交属性修改',
        `${ok}/${changes.length} 项成功${r.results.some((v) => !v.success) ? '，存在部分失败' : ''}`,
        ok === changes.length ? 'success' : 'warning',
      )
      setDraft((prev) => {
        const next = { ...prev }
        r.results
          .filter((v) => v.success)
          .forEach((v) => delete next[keyOf(v.modelId, v.propertyName)])
        return next
      })
      setSnap((prev) =>
        prev
          ? {
              ...prev,
              models: prev.models.map((m) => ({
                ...m,
                properties: m.properties.map((p) => {
                  const c = draft[keyOf(m.id, p.name)],
                    success = r.results.find(
                      (v) => v.modelId === m.id && v.propertyName === p.name && v.success,
                    )
                  return c && success ? { ...p, value: c.newValue } : p
                }),
              })),
            }
          : prev,
      )
      setNotice({
        text: `${ok} 项成功，${r.results.filter((v) => !v.success).length} 项失败。请检查下方结果并重新读取确认。`,
        error: ok !== changes.length,
      })
    })
  }
  async function exportReport() {
    const content = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        session,
        snapshotId: snap?.id,
        changes,
        result,
        operations: logs,
      },
      null,
      2,
    )
    if (window.cadweave?.exportFile) {
      const r = await window.cadweave.exportFile({
        suggestedName: 'CadWeave-操作报告.json',
        content,
      })
      if (r.cancelled) return
    } else exportText('CadWeave-操作报告.json', content, 'application/json')
    log('导出操作报告', '已导出当前操作记录与变更结果')
  }
  function pasteRect(e: React.ClipboardEvent<HTMLInputElement>, m: Model, property: string) {
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
    )
    cells.forEach((c) => editValue(c.model, c.propertyName, c.value))
    setNotice({
      text: `已粘贴 ${cells.length} 个单元格${skipped ? `，跳过 ${skipped} 个只读或越界单元格` : ''}。尚未提交。`,
    })
  }
  return (
    <div className={`app ${settings.dense ? 'compact' : ''}`}>
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
              onClick={() => setPage(n.id)}
              title={n.label}
            >
              <n.icon size={21} />
              <span>{n.label.slice(0, 2)}</span>
            </button>
          ))}
        </div>
        <div className="rail-bottom">
          <IconButton
            title="使用说明"
            onClick={() =>
              setConfirmation({
                title: '安全地编辑 CAD 属性',
                text: '连接 → 读取快照 → 编辑现有属性 → 预览变更 → 确认保存。多文档保存不具备事务性；遇到部分失败，请检查逐项结果。只读、已有未保存修改的模型不能编辑。Ctrl+C/V 可复制和粘贴表格文本，矩形粘贴会跳过只读单元格。',
                action: () => {},
              })
            }
          >
            <CircleHelp size={20} />
          </IconButton>
          <div className="avatar">CW</div>
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
                  {i === 0 ? (
                    <Minus size={14} />
                  ) : i === 1 ? (
                    <Maximize2 size={12} />
                  ) : (
                    <X size={15} />
                  )}
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
                <div className="eyebrow">ENGINEERING WORKSPACE</div>
                <h1>
                  属性工作台 <span>工程数据，一处掌控</span>
                </h1>
              </div>
              <div className="title-actions">
                <button className="button" onClick={() => void exportReport()}>
                  <ArrowDownToLine size={15} />
                  导出报告
                </button>
                <button
                  className="button primary"
                  data-testid="preview-changes"
                  disabled={!changes.length || !!busy || needsRefresh}
                  onClick={() => setModal('preview')}
                >
                  <Save size={15} />
                  预览并提交{changes.length > 0 && <b>{changes.length}</b>}
                </button>
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
                    <span className="count">{snap.models.length}</span>
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
                    <span>{snap.title}</span>
                    <button
                      title="显示所有模型"
                      onClick={() => {
                        setFocusedModel(null)
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
                      collapsedIds={collapsed}
                      onToggle={(id) =>
                        setCollapsed((prev) => {
                          const next = new Set(prev)
                          next.has(id) ? next.delete(id) : next.add(id)
                          return next
                        })
                      }
                      onLocate={(id) => {
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
                  <div className="snapshot-note">
                    <ShieldCheck size={16} />
                    <div>
                      <strong>快照保护已启用</strong>
                      <span>提交时校验原值与写入能力</span>
                    </div>
                  </div>
                </aside>
                <section className="matrix-panel">
                  <div className="matrix-heading">
                    <div>
                      <h2>
                        属性矩阵 <span>{models.length} 个模型</span>
                      </h2>
                      <p>
                        {focusedModel
                          ? '已定位单个模型'
                          : '编辑现有属性，所有修改提交前仅保存在本地'}
                        {focusedModel && (
                          <button className="text-button" onClick={() => setFocusedModel(null)}>
                            显示全部
                          </button>
                        )}
                      </p>
                    </div>
                    <div className="matrix-heading-actions">
                      <select
                        aria-label="属性作用域"
                        value={snap.scope}
                        disabled={!!busy}
                        onChange={(e) => refresh(e.target.value as Snapshot['scope'])}
                      >
                        <option value="document">文档属性</option>
                        {cap?.configurations && <option value="configuration">配置属性</option>}
                      </select>
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
                      disabled={!selected.size || !cap?.writable || !!busy}
                      onClick={() => {
                        setBatchProp(batchColumns[0] ?? '')
                        setBatchValue('')
                        setModal('batch')
                      }}
                    >
                      <ClipboardPaste size={15} />
                      批量赋值
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
                                  <span>
                                    {m.name}
                                    {settings.showPaths && <small>{m.path}</small>}
                                  </span>
                                  {!m.writable && <LockKeyhole size={12} />}
                                </button>
                              </td>
                              {columns.map((name) => {
                                const p = m.properties.find((p) => p.name === name),
                                  c = draft[keyOf(m.id, name)],
                                  writable = editable(m, name)
                                return (
                                  <td
                                    key={name}
                                    className={`${c ? 'cell-dirty' : ''} ${!writable ? 'cell-readonly' : ''}`}
                                    title={
                                      c
                                        ? `原值：${p?.value || '（空）'}`
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
                                        value={c?.newValue ?? p.value}
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
                                      <span className="missing">—</span>
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
                                    {m.dirty ? '未保存' : '只读'}
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
                              <dd>{snap.scope === 'configuration' ? '当前配置' : '文档'}</dd>
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
                        提交已执行或状态可能变化，必须重新读取快照后才能继续编辑。未成功项请先导出报告留存。
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
                    <span>
                      <span className="legend-dot" />{' '}
                      {changes.length ? `${changes.length} 项本地修改，尚未提交` : '无待提交修改'}{' '}
                      <span className="shortcut">Ctrl C / V</span>
                    </span>
                  </div>
                  {snap.warnings.length > 0 && (
                    <div className="warning-strip">
                      <Info size={13} />
                      <span>{snap.warnings.join(' · ')}</span>
                    </div>
                  )}
                  {result && (
                    <div className="result-panel">
                      <div>
                        <strong>最近提交结果</strong>
                        <span>
                          {result.results.filter((r) => r.success).length} 成功 /{' '}
                          {result.results.filter((r) => !r.success).length} 失败
                        </span>
                        <button className="text-button" onClick={() => refresh()}>
                          重新读取确认 <RefreshCw size={12} />
                        </button>
                      </div>
                      {result.results.map((r, i) => (
                        <p key={i} className={!r.success ? 'failure' : ''}>
                          {r.success ? <Check size={12} /> : <X size={12} />}
                          <b>
                            {snap.models.find((m) => m.id === r.modelId)?.name ?? r.modelId} ·{' '}
                            {r.propertyName}
                          </b>
                          <span>
                            {r.message} · {r.saved ? '已保存' : '未保存文件'} ·{' '}
                            {r.verified ? '已重读核对（非重开验证）' : '未重读核对'}
                          </span>
                        </p>
                      ))}
                      {result.backupDirectory && <p>备份目录：{result.backupDirectory}</p>}
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        ) : (
          <main className="page-content">
            <div className="page-title">
              <div className="eyebrow">
                {page === 'connections'
                  ? 'CONNECTION CENTER'
                  : page === 'templates'
                    ? 'PROPERTY TEMPLATES'
                    : page === 'history'
                      ? 'OPERATION HISTORY'
                      : 'PREFERENCES'}
              </div>
              <h1>{nav.find((n) => n.id === page)?.label}</h1>
              <p>
                {page === 'connections'
                  ? '连接正在运行的 CAD 会话，建立可追溯的工程数据工作流。'
                  : page === 'templates'
                    ? '保存常用属性值，一次应用到多个模型。模板只修改已有且可写的属性。'
                    : page === 'history'
                      ? '仅记录当前会话实际发生的操作，不生成虚构历史。'
                      : '按你的工作习惯配置界面，设置仅保存在当前设备。'}
              </p>
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
                      setDraft({})
                      setResult(null)
                      if (session) log('断开连接', session.label)
                    })
                  })
                }
              />
            )}
            {page === 'templates' && (
              <>
                <div className="section-toolbar">
                  <h2>
                    我的模板 <span className="count">{templates.length}</span>
                  </h2>
                  <button
                    className="button primary"
                    disabled={!snap || !columns.length}
                    onClick={() => {
                      setTemplateName('')
                      setModal('template')
                    }}
                  >
                    <Plus size={15} />
                    从当前模型创建
                  </button>
                </div>
                {!templates.length ? (
                  <Empty
                    icon={<Layers3 size={34} />}
                    title="把重复录入，变成一次操作"
                    text="连接模型后，从当前选中或第一个模型保存一个属性模板。模板保存在本地，不会自动写入 CAD。"
                  />
                ) : (
                  <div className="template-grid">
                    {templates.map((t) => (
                      <article className="template-card" key={t.id}>
                        <div className="template-card-top">
                          <div className="template-icon">
                            <Layers3 size={22} />
                          </div>
                          <IconButton
                            title={`删除模板 ${t.name}`}
                            onClick={() =>
                              setConfirmation({
                                title: '删除此模板？',
                                text: t.name,
                                action: () => setTemplates((v) => v.filter((a) => a.id !== t.id)),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                        <h2>{t.name}</h2>
                        <p>{t.description}</p>
                        <div className="template-values">
                          {Object.entries(t.values)
                            .slice(0, 4)
                            .map(([k, v]) => (
                              <div key={k}>
                                <span>{k}</span>
                                <b>{v || '（空）'}</b>
                              </div>
                            ))}
                        </div>
                        <button
                          className="button"
                          disabled={!selectedModels.length || !!busy}
                          onClick={() => {
                            let count = 0
                            selectedModels.forEach((m) =>
                              Object.entries(t.values).forEach(([p, v]) => {
                                if (editable(m, p)) {
                                  editValue(m, p, v)
                                  count++
                                }
                              }),
                            )
                            setNotice({
                              text: `模板已赋值 ${count} 项可写属性；仅生成本地修改，需预览提交。`,
                            })
                            setPage('workspace')
                          }}
                        >
                          应用到 {selected.size} 个选中模型
                          <ArrowRight size={14} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                <div className="info-card">
                  <Info size={18} />
                  <p>
                    模板应用尊重模型与属性的只读限制。请先在工作台勾选目标模型，应用后预览变更并确认提交。
                  </p>
                </div>
              </>
            )}
            {page === 'history' && (
              <>
                <div className="section-toolbar">
                  <h2>
                    本次会话 <span className="count">{logs.length}</span>
                  </h2>
                  <button
                    className="button"
                    disabled={!logs.length}
                    onClick={() => void exportReport()}
                  >
                    <ArrowDownToLine size={15} />
                    导出记录
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
                        </div>
                        <time>{l.time}</time>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
            {page === 'settings' && (
              <>
                <section className="settings-card">
                  <h2>
                    <SlidersHorizontal size={18} />
                    显示与编辑
                  </h2>
                  {(
                    [
                      {
                        key: 'dense',
                        title: '紧凑行高',
                        text: '缩小属性矩阵行高，在一个屏幕内查看更多模型。',
                      },
                      {
                        key: 'showReadonly',
                        title: '显示只读模型',
                        text: '只读模型保留在矩阵中并明确标记，不允许编辑。',
                      },
                      {
                        key: 'showPaths',
                        title: '显示模型路径',
                        text: '在模型名称下方显示源文件路径。',
                      },
                    ] as const
                  ).map((s) => (
                    <label className="setting-row" key={s.key}>
                      <span>
                        <strong>{s.title}</strong>
                        <small>{s.text}</small>
                      </span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={settings[s.key]}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            [s.key]: e.target.checked,
                          })
                        }
                      />
                    </label>
                  ))}
                </section>
                <section className="settings-card">
                  <h2>
                    <ShieldCheck size={18} />
                    安全策略
                  </h2>
                  <div className="policy-grid">
                    <div>
                      <CheckCheck size={20} />
                      <strong>快照一致性</strong>
                      <p>所有提交绑定读取时的快照 ID，校验属性原值。</p>
                    </div>
                    <div>
                      <LockKeyhole size={20} />
                      <strong>只读保护</strong>
                      <p>不可写属性、模型已有未保存修改时禁止编辑。</p>
                    </div>
                    <div>
                      <FileText size={20} />
                      <strong>逐项报告</strong>
                      <p>多文档保存非事务操作，明确展示每项保存和验证状态。</p>
                    </div>
                  </div>
                </section>
                <div className="about-line">
                  <span className="small-brand">CadWeave</span>
                  <span>工程属性工作台 · 协议 v1</span>
                  <span>真实 CAD 会话</span>
                </div>
              </>
            )}
          </main>
        )}
        <footer className="app-status">
          <span>
            <span className={session ? 'online-dot' : 'offline-dot'} />
            {busy ||
              (session
                ? `${cap?.displayName ?? session.label} · ${snap?.scope === 'configuration' ? '配置作用域' : '文档作用域'}`
                : '就绪 · 请选择连接')}
          </span>
          <span>
            {snap ? `${snap.models.length} 模型 · ${columns.length} 属性列` : '安全快照 · 明确提交'}
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
      {modal && (
        <div className="modal-backdrop">
          <section
            className={`modal ${modal === 'preview' ? 'preview-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'preview' ? '提交预览' : modal === 'batch' ? '批量赋值' : '创建属性模板'
            }
          >
            <div className="modal-header">
              <div>
                <h2>
                  {modal === 'preview'
                    ? '提交预览'
                    : modal === 'batch'
                      ? '批量赋值'
                      : '创建属性模板'}
                </h2>
                <p>
                  {modal === 'preview'
                    ? `确认 ${changes.length} 项属性变更并写入 CAD 文档`
                    : modal === 'batch'
                      ? `作用于 ${selectedModels.length} 个选中模型，仅修改既有可写属性`
                      : '从选中模型或第一个模型保存现有属性值'}
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
                  <span>确认即授权保存。多文档保存不具备事务性，可能出现部分成功。</span>
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
                            <small>{c.propertyName}</small>
                          </td>
                          <td>{c.oldValue || '（空）'}</td>
                          <td className="modified-text">{c.newValue || '（空）'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="modal-footer">
                  <span>以当前快照校验原值后提交</span>
                  <button className="button" onClick={() => setModal(null)}>
                    返回编辑
                  </button>
                  <button
                    className="button primary"
                    data-testid="apply-changes"
                    disabled={!!busy || !changes.length}
                    onClick={() => void apply()}
                  >
                    <Save size={15} />
                    确认写入并保存
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
            {modal === 'template' && (
              <>
                <div className="modal-fields">
                  <label>
                    模板名称
                    <input
                      autoFocus
                      placeholder="例如：设计发布标准"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    来源：{(selectedModels[0] ?? snap?.models[0])?.name}
                    。包含当前本地修改的属性值。
                  </p>
                </div>
                <div className="modal-footer">
                  <button className="button" onClick={() => setModal(null)}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    disabled={!templateName.trim()}
                    onClick={() => {
                      const m = selectedModels[0] ?? snap?.models[0]
                      if (!m) return
                      setTemplates((v) => [
                        ...v,
                        {
                          id: crypto.randomUUID(),
                          name: templateName.trim(),
                          description: `${m.properties.length} 项属性 · 来源 ${m.name}`,
                          values: Object.fromEntries(
                            m.properties.map((p) => [
                              p.name,
                              draft[keyOf(m.id, p.name)]?.newValue ?? p.value,
                            ]),
                          ),
                        },
                      ])
                      setModal(null)
                      setNotice({ text: '属性模板已保存在本地。' })
                    }}
                  >
                    保存模板
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
