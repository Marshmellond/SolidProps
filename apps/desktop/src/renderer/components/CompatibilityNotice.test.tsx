import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompatibilityNotice } from './CompatibilityNotice'
import type { Capabilities, Session } from '../types'

const session: Session = {
  id: 'solidworks:1:0',
  cadId: 'solidworks',
  label: 'SolidWorks · PID 1',
  version: '33.0.0',
  connectable: true,
  detail: '',
}
const capabilities = (writable: boolean, notes: string): Capabilities => ({
  cadId: 'solidworks',
  displayName: 'SolidWorks',
  writable,
  notes,
})

describe('CompatibilityNotice', () => {
  it('shows the version-specific read-only reason', () => {
    const html = renderToStaticMarkup(
      <CompatibilityNotice
        session={session}
        capabilities={capabilities(false, 'SolidWorks 33.0.0：仅可读取；写回仅认证 34.0.0。')}
      />,
    )
    expect(html).toContain('SolidWorks 33.0.0')
    expect(html).toContain('仅可读取')
  })

  it('stays hidden when writable, without notes, or disconnected', () => {
    expect(
      renderToStaticMarkup(
        <CompatibilityNotice session={session} capabilities={capabilities(true, '可写')} />,
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(
        <CompatibilityNotice session={session} capabilities={capabilities(false, '')} />,
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(<CompatibilityNotice session={null} capabilities={null} />),
    ).toBe('')
  })
})
