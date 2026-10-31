import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Boxes,
  Check,
  FileClock,
  Info,
  LayoutGrid,
  Link2,
  Loader2,
  Square,
  Minus,
  Save,
  X,
} from 'lucide-react'
import type {
  ApplyResult,
  Bridge,
  Capabilities,
  Change,
  Diagnostic,
  Operation,
  Page,
  Session,
  Snapshot,
} from './types'
import { exportText, request } from './bridge'
import { PropertyWorkbench } from './components/PropertyWorkbench'
import { ConnectionPage } from './components/ConnectionPage'
import { EditActions } from './components/EditActions'
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
  const [savedSignature, setSavedSignature] = useState('[]')
  const [savedAt, setSavedAt] = useState('')
  const [draftConflicts, setDraftConflicts] = useState(0)
  const [draft, setDraft] = useState<Record<string, Change>>({}),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<'preview' | null>(null),
    [confirmation, setConfirmation] = useState<{
      title: string
      text: string
      action: () => void
    } | null>(null)
  const [logs, setLogs] = useState<Operation[]>([])
  const [needsRefresh, setNeedsRefresh] = useState(false)
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
    if (!editing || !snap || busy || needsRefresh) return
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
        setSelected(new Set())
        const data = await request<Snapshot>('snapshot', { scope: 'document' })
        setSnap(data)
        await loadSavedDraft(data)
        setPage('workspace')
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
  const draftSaved =
    changes.length > 0 && savedSignature === draftSignature(draft) && !draftConflicts
  async function apply() {
    if (busy || editing || !snap || !draftSaved || needsRefresh) return
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
              <PropertyWorkbench
                snapshot={snap}
                selected={selected}
                onSelectionChange={setSelected}
                draft={draft}
                onDraftChange={setDraft}
                capabilities={cap}
                editing={editing}
                busy={!!busy}
                needsRefresh={needsRefresh}
                onRefresh={refresh}
              />
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
            {snap
              ? draftConflicts
                ? `${draftConflicts} 项草稿冲突，暂不能提交`
                : `${new Set(changes.map((c) => c.modelId)).size} 个文件 · ${changes.length} 项变更 · ${editing && draftSignature(draft) !== savedSignature ? '编辑未保存' : draftSaved ? '已保存待提交' : '无待提交变更'}`
              : ''}
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
            className="modal preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="提交属性修改"
          >
            <div className="modal-header">
              <div>
                <h2>提交属性修改</h2>
                <p>
                  {`确认全部已保存变更：${new Set(changes.map((c) => c.modelId)).size} 个文件 · ${changes.length} 项，写入 CAD 文档`}
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
          </section>
        </div>
      )}
    </div>
  )
}
