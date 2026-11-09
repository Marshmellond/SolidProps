import { Activity, ArrowRight, Monitor, RefreshCw, Unplug } from 'lucide-react'
import type { Diagnostic, Session } from '../types'

export interface ConnectionPageProps {
  sessions: Session[]
  diagnostics: Diagnostic[]
  session: Session | null
  busy: boolean
  onDiscover: () => void
  onConnect: (session: Session) => void
  onDisconnect: () => void
}

/** Presentation only: discovery, connection and dirty-state guards remain owned by App. */
export function ConnectionPage({
  sessions,
  diagnostics,
  session,
  busy,
  onDiscover,
  onConnect,
  onDisconnect,
}: ConnectionPageProps) {
  return (
    <>
      <div className="section-toolbar">
        <h2>
          可用会话 <span className="count">{sessions.length}</span>
        </h2>
        <button className="button" disabled={busy} onClick={onDiscover}>
          <RefreshCw size={15} />
          刷新连接池
        </button>
      </div>
      <div className="connection-grid">
        {sessions.map((s) => (
          <article key={s.id} className="connection-card" data-testid="session-select">
            <div className="connection-card-top">
              <div className="cad-icon">
                <Monitor size={28} />
              </div>
              <span className={`tag ${s.connectable ? 'synced-tag' : 'modified-tag'}`}>
                {session?.id === s.id ? '已连接' : s.connectable ? '可连接' : '不可连接'}
              </span>
            </div>
            <h2>{s.label}</h2>
            {!s.connectable && <p>{s.detail}</p>}
            {session?.id === s.id ? (
              <button
                className="button primary"
                data-testid="disconnect-button"
                disabled={busy}
                onClick={onDisconnect}
              >
                断开连接
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                className="button primary"
                data-testid="connect-button"
                disabled={!s.connectable || busy}
                onClick={() => onConnect(s)}
              >
                连接并读取模型
                <ArrowRight size={15} />
              </button>
            )}
          </article>
        ))}
      </div>
      {!sessions.length && !busy && (
        <div className="empty">
          <div className="empty-icon">
            <Unplug size={34} />
          </div>
          <h2>尚未发现可连接会话</h2>
        </div>
      )}
      {diagnostics.some((d) => d.level !== 'info') && (
        <details className="diagnostics">
          <summary>连接诊断</summary>
          <section>
            <h3>
              <Activity size={16} />
              发现诊断
            </h3>
            {diagnostics.map((d, i) => (
              <div key={i} className={d.level}>
                <span className="tag">SolidWorks</span>
                <p>{d.message}</p>
                <span>
                  {d.level === 'error' ? '错误' : d.level === 'warning' ? '提示' : '信息'}
                </span>
              </div>
            ))}
          </section>
        </details>
      )}
    </>
  )
}
