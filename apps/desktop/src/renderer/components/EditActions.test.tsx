import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditActions, type EditActionsProps } from './EditActions'

function render(overrides: Partial<EditActionsProps> = {}) {
  return renderToStaticMarkup(
    <EditActions
      editing={false}
      canStart
      busy={false}
      locked={false}
      changeCount={0}
      onStart={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  )
}

describe('explicit property editing actions', () => {
  it('starts in view mode with an edit button, not a save button', () => {
    const html = render()
    expect(html).toContain('编辑属性')
    expect(html).not.toContain('preview-changes')
    expect(html).not.toContain('disabled')
  })
  it('does not allow entering edit mode without writable properties', () => {
    expect(render({ canStart: false })).toContain('disabled')
    expect(render({ locked: true })).toContain('disabled')
    expect(render({ busy: true })).toContain('disabled')
  })
  it('offers cancel and disabled save when editing without changes', () => {
    const html = render({ editing: true })
    expect(html).toContain('取消编辑')
    expect(html).toMatch(/data-testid="preview-changes" disabled/)
    expect(html).not.toContain('edit-properties')
  })
  it('enables save with changes and displays their count', () => {
    const html = render({ editing: true, changeCount: 3 })
    expect(html).toContain('保存<b>3</b>')
    expect(html).not.toContain('disabled')
  })
  it('locks saving after an uncertain result but keeps cancellation available', () => {
    const html = render({ editing: true, locked: true, changeCount: 2 })
    expect(html).toMatch(/data-testid="preview-changes" disabled/)
    expect(html).not.toMatch(/data-testid="cancel-edit" disabled/)
  })
  it('disables save and cancel during an operation', () => {
    const html = render({ editing: true, busy: true, changeCount: 2 })
    expect(html).toMatch(/data-testid="preview-changes" disabled/)
    expect(html).toMatch(/data-testid="cancel-edit" disabled/)
  })
})
