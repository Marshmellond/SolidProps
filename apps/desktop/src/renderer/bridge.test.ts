import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('native CAD bridge only', () => {
  it('does not create fake sessions or model snapshots in a browser', async () => {
    vi.stubGlobal('window', {})
    const bridge = await import('./bridge')
    await expect(bridge.request('discover')).rejects.toThrow('桌面 CAD 桥接')
    await expect(bridge.request('snapshot', { scope: 'document' })).rejects.toThrow(
      '桌面 CAD 桥接',
    )
  })

  it('forwards discovery and connection requests directly to the native CAD bridge', async () => {
    const sessions = [
      {
        id: 'solidworks:1',
        cadId: 'solidworks',
        label: 'SolidWorks · PID 1',
        version: '34.0.0',
        connectable: true,
        detail: '已发现',
      },
    ]
    const native = vi.fn(async (method: string) =>
      method === 'discover' ? { sessions, diagnostics: [] } : { session: sessions[0] },
    )
    vi.stubGlobal('window', { cadweave: { request: native } })
    const bridge = await import('./bridge')
    const found = await bridge.request<{ sessions: typeof sessions }>('discover')
    expect(found.sessions).toEqual(sessions)
    const connected = await bridge.request('connect', { sessionId: sessions[0].id })
    expect(connected).toMatchObject({ session: sessions[0] })
    expect(native.mock.calls.map(([method]) => method)).toEqual(['discover', 'connect'])
  })

  it('surfaces native CAD failures without substituting another session', async () => {
    const native = vi.fn().mockRejectedValue(new Error('SolidWorks connection failed'))
    vi.stubGlobal('window', { cadweave: { request: native } })
    const bridge = await import('./bridge')
    await expect(bridge.request('connect', { sessionId: 'solidworks:1' })).rejects.toThrow(
      'SolidWorks connection failed',
    )
    expect(native).toHaveBeenCalledTimes(1)
  })
})
