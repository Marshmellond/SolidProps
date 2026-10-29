import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../types'
import { ConnectionPage } from './ConnectionPage'

const sessions: Session[] = [
  {
    id: 'solidworks:1',
    cadId: 'solidworks',
    label: 'SolidWorks · PID 1',
    version: '34.0.0',
    connectable: true,
    detail: '附着现有会话',
  },
  {
    id: 'solidworks:2',
    cadId: 'solidworks',
    label: 'SolidWorks · PID 2',
    version: '未知',
    connectable: false,
    detail: 'API未配置',
  },
]

describe('CAD connection page', () => {
  it('lists only actual CAD sessions and contains no demo affordances', () => {
    const html = renderToStaticMarkup(
      <ConnectionPage
        sessions={sessions}
        diagnostics={[]}
        session={null}
        capabilities={null}
        busy={false}
        onDiscover={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    )
    expect(html).toContain('SolidWorks · PID 1')
    expect(html).toContain('SolidWorks · PID 2')
    expect(html).toContain('不可连接')
    expect(html).toContain('连接并读取模型')
    expect(html).not.toContain('演示')
    expect(html).not.toContain('demo')
  })
})
