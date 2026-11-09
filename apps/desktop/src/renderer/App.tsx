import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  Boxes,
  Info,
  LayoutGrid,
  Link2,
  Loader2,
  Square,
  Minus,
  RefreshCw,
  Save,
  X,
} from 'lucide-react'
import type {
  AppInfo,
  ApplyResult,
  Bridge,
  Capabilities,
  Change,
  Diagnostic,
  Page,
  Session,
  Snapshot,
} from './types'
import { request } from './bridge'
import { PropertyWorkbench } from './components/PropertyWorkbench'
import { ConnectionPage } from './components/ConnectionPage'
import { AboutPage } from './components/AboutPage'
import { EditActions } from './components/EditActions'
import { AssemblyTree } from './components/AssemblyTree'
import { CompatibilityNotice } from './components/CompatibilityNotice'
import { draftKey, draftEntries, draftSignature, restoreDraft, type SavedDraft } from './drafts'

async function local<T>(method: string, params: unknown = {}): Promise<T> {
  if (!window.cadweave?.local) throw new Error('请使用更新后的桌面应用。')
  return window.cadweave.local(method, params) as Promise<T>
}

declare global {
  interface Window {
    cadweave?: Bridge & {
      windowControl?: (action: 'minimize' | 'maximize' | 'close') => void
      appInfo?: () => Promise<AppInfo>
      openExternal?: (url: string) => void
    }
  }
}
const nav = [
  { id: 'workspace', label: '工作台', icon: LayoutGrid },
  { id: 'connections', label: '连接', icon: Link2 },
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
  text?: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
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
    [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<'preview' | null>(null),
    [confirmation, setConfirmation] = useState<{
      title: string
      text: string
      action: () => void
    } | null>(null)
  const [assemblyOpen, setAssemblyOpen] = useState(false)
  const [assemblyQuery, setAssemblyQuery] = useState('')
  const [assemblyLevel, setAssemblyLevel] = useState(Infinity)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const booted = useRef(false)
  const changes = Object.values(draft)
  const [undoHistory, setUndoHistory] = useState<Record<string, Change>[]>([])
  const [redoHistory, setRedoHistory] = useState<Record<string, Change>[]>([])
  const lastChangeKey = useRef<string | null>(null)
  function resetUndo() {
    setUndoHistory([])
    setRedoHistory([])
    lastChangeKey.current = null
  }
  function updateDraft(next: Record<string, Change>) {
    const keys = new Set([...Object.keys(draft), ...Object.keys(next)])
    const changed = [...keys].filter((key) => draft[key] !== next[key])
    if (!changed.length) return
    const onlyKey = changed.length === 1 ? changed[0] : null
    // Consecutive keystrokes on the same property collapse into one undo step.
    if (!(onlyKey && onlyKey === lastChangeKey.current)) {
      setUndoHistory((history) => [...history.slice(-49), draft])
      setRedoHistory([])
    }
    lastChangeKey.current = onlyKey
    setDraft(next)
  }
  function undoLast() {
    if (!undoHistory.length) return
    const previous = undoHistory[undoHistory.length - 1]
    setRedoHistory((history) => [...history.slice(-49), draft])
    setDraft(previous)
    setUndoHistory(undoHistory.slice(0, -1))
    lastChangeKey.current = null
  }
  function redoLast() {
    if (!redoHistory.length) return
    const next = redoHistory[redoHistory.length - 1]
    setUndoHistory((history) => [...history.slice(-49), draft])
    setDraft(next)
    setRedoHistory(redoHistory.slice(0, -1))
    lastChangeKey.current = null
  }
  function undoAll() {
    if (!changes.length) return
    setConfirmation({
      title: '撤回全部修改？',
      text: '将清除所有尚未提交的属性修改，不会修改 CAD 文件。',
      action: () => {
        setDraft({})
        resetUndo()
      },
    })
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setNotice({ text: errorText(e), error: true })
    } finally {
      setBusy('')
    }
  }
  async function discover() {
    await run('发现 SolidWorks 会话', async () => {
      const r = await request<{
        sessions: Session[]
        diagnostics: Diagnostic[]
      }>('discover')
      setSessions(r.sessions)
      setDiagnostics(r.diagnostics)
    })
  }
  useEffect(() => {
    if (!booted.current) {
      booted.current = true
      void discover()
    }
    window.cadweave?.appInfo?.().then(setAppInfo).catch(() => {})
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
          resetUndo()
          action()
        },
      })
    else action()
  }
  async function loadSavedDraft(data: Snapshot) {
    setDraft({})
    resetUndo()
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
        text: `${restored.conflicts.length} 项草稿与当前模型冲突，未载入这些项；请检查当前属性后重新编辑并保存。`,
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
    })
  }
  function connect(s: Session) {
    const reconnecting = session !== null
    const keep = session?.id === s.id ? selected : null
    const keepPage = page
    const keepEditing = editing
    guard(session && session.id !== s.id ? '切换连接？' : '重新连接？', () => {
      void run('连接会话', async () => {
        if (session) {
          await request('disconnect')
          setSession(null)
          setCap(null)
          setSnap(null)
          setEditing(false)
          setDraft({})
          resetUndo()
        }
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
        setSelected(null)
        const data = await request<Snapshot>('snapshot', { scope: 'document' })
        setSnap(data)
        const nextSelected = keep && data.models.some((m) => m.id === keep) ? keep : null
        setSelected(nextSelected)
        await loadSavedDraft(data)
        // Reconnecting keeps the current page; a first connection always opens the workbench.
        setPage(reconnecting ? keepPage : 'workspace')
        if (
          keepPage === 'workspace' &&
          keepEditing &&
          c.capabilities.writable &&
          nextSelected &&
          data.models.some((m) => m.id === nextSelected && m.writable && !m.dirty)
        )
          setEditing(true)
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
        setSelected(
          [selected, snap.id].find((id) => id && data.models.some((m) => m.id === id)) ??
            data.models[0]?.id ??
            null,
        )
        await loadSavedDraft(data)
      } catch (e) {
        setNeedsRefresh(true)
        failure += `${failure ? '；' : ''}自动读取失败：${errorText(e)}`
      }
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
  return (
    <div className="app">
      <aside className="rail">
        <button className="brand-mark" title="SolidProps" onClick={() => setPage('workspace')}>
          <span>S</span>
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
              <span>{n.label}</span>
            </button>
          ))}
        </div>
        <div className="rail-nav rail-bottom">
          <button
            className={page === 'about' ? 'active' : ''}
            onClick={() => setPage('about')}
            title="关于"
          >
            <Info size={21} />
            <span>关于</span>
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="wordmark">SolidProps</div>
          <div className="top-right">
            {session && (
              <button className="topbar-button" disabled={!!busy} onClick={() => connect(session)}>
                <RefreshCw size={15} />
                重新连接
              </button>
            )}
            <span className={`connection-pill ${session ? 'online' : ''}`}>
              <i />
              {session ? session.label : '尚未连接 SolidWorks'}
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
        <CompatibilityNotice session={session} capabilities={cap} />
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
                  hideStart
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
              <Empty icon={<Boxes size={36} />} title="连接 SolidWorks">
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
                onDraftChange={updateDraft}
                capabilities={cap}
                editing={editing}
                busy={!!busy}
                needsRefresh={needsRefresh}
                canUndo={undoHistory.length > 0}
                canRedo={redoHistory.length > 0}
                onUndo={undoLast}
                onRedo={redoLast}
                onUndoAll={undoAll}
                onEdit={() => setEditing(true)}
                onShowAssembly={() => {
                  setAssemblyQuery('')
                  setAssemblyLevel(Infinity)
                  setAssemblyOpen(true)
                }}
              />
            )}
          </>
        ) : (
          <main className="page-content">
            <div className="page-title">
              <h1>{page === 'about' ? '关于' : nav.find((n) => n.id === page)?.label}</h1>
            </div>
            {page === 'about' && <AboutPage info={appInfo} />}
            {page === 'connections' && (
              <ConnectionPage
                sessions={sessions}
                diagnostics={diagnostics}
                session={session}
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
                      resetUndo()
                    })
                  })
                }
              />
            )}
          </main>
        )}
        <footer className="app-status">
          <span>
            {snap
              ? draftConflicts
                ? `${draftConflicts} 项草稿冲突，暂不能提交`
                : `${changes.length} 项变更 · ${editing && draftSignature(draft) !== savedSignature ? '编辑未保存' : draftSaved ? '已保存待提交' : '无待提交变更'}`
              : ''}
          </span>
        </footer>
      </div>
      {busy && (
        <div className="busy-indicator" role="status">
          <Loader2 size={17} className="spin" />
          {busy}…
        </div>
      )}
      {assemblyOpen && snap && (
        <div className="modal-backdrop assembly-backdrop">
          <section
            className="modal assembly-modal"
            role="dialog"
            aria-modal="true"
            aria-label="装配结构（只读）"
          >
            <div className="modal-header">
              <h2>装配结构</h2>
              <IconButton
                title="关闭装配结构"
                onClick={() => {
                  setAssemblyOpen(false)
                  setAssemblyQuery('')
                }}
              >
                <X size={18} />
              </IconButton>
            </div>
            <label className="search-field assembly-search">
              <input
                aria-label="搜索装配结构"
                placeholder="搜索实例名称"
                value={assemblyQuery}
                onChange={(e) => setAssemblyQuery(e.target.value)}
              />
            </label>
            <div className="assembly-toolbar">
              <button
                className="button"
                onClick={() => setAssemblyLevel(assemblyLevel === Infinity ? 0 : Infinity)}
              >
                {assemblyLevel === Infinity ? '收起全部' : '展开全部'}
              </button>
            </div>
            <div className="assembly-scroll">
              <AssemblyTree
                root={snap.root}
                query={assemblyQuery.trim()}
                expandLevel={assemblyLevel}
              />
            </div>
          </section>
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
