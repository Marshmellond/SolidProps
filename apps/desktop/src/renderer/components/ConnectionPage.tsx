import { Activity, ArrowRight, Monitor, RefreshCw, Unplug } from 'lucide-react'
import type { Capabilities, Diagnostic, Session } from '../types'

export interface ConnectionPageProps {
  sessions: Session[]
  diagnostics: Diagnostic[]
  session: Session | null
  capabilities: Capabilities | null
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
  capabilities,
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
          重新发现
        </button>
      </div>
      <div className="connection-grid">
        {sessions.map((s) => (
          <article
            key={s.id}
            className="connection-card"
            data-testid="session-select"
          >
            <div className="connection-card-top">
              <div className="cad-icon">
                <Monitor size={28} />
              </div>
              <span className={`tag ${s.connectable ? 'synced-tag' : 'modified-tag'}`}>
                {s.connectable ? '可连接' : '不可连接'}
              </span>
            </div>
            <h2>{s.label}</h2>
            <div className="session-version">
              {s.version}
              {s.pid ? ` · PID ${s.pid}` : ''}
            </div>
            <p>{s.detail}</p>
            <button
              className="button primary"
              data-testid="connect-button"
              disabled={!s.connectable || busy}
              onClick={() => onConnect(s)}
            >
              {session?.id === s.id
                ? '重新连接并读取'
                : '连接并读取模型'}
              <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
      {!sessions.length && !busy && (
        <div className="empty">
          <div className="empty-icon">
            <Unplug size={34} />
          </div>
          <h2>尚未发现可连接会话</h2>
          <p>请启动受支持的 CAD 并打开模型，再点击重新发现。</p>
        </div>
      )}
      {diagnostics.length > 0 && (
        <section className="diagnostics">
          <h3>
            <Activity size={16} />
            发现诊断
          </h3>
          {diagnostics.map((d, i) => (
            <div key={i} className={d.level}>
              <span className="tag">{d.cadId}</span>
              <p>{d.message}</p>
              <span>{d.level === 'error' ? '错误' : d.level === 'warning' ? '提示' : '信息'}</span>
            </div>
          ))}
        </section>
      )}
      {session && (
        <div className="connected-summary">
          <div>
            <span className="online-dot" />
            <strong>当前连接：{session.label}</strong>
            <p>{capabilities?.notes}</p>
          </div>
          <button className="button" disabled={busy} onClick={onDisconnect}>
            <Unplug size={15} />
            断开连接
          </button>
        </div>
      )}
    </>
  )
}
