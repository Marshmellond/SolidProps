import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssemblyTree, type AssemblyTreeProps } from './AssemblyTree'
import type { Occurrence } from '../types'

const root: Occurrence = {
  id: 'root',
  name: 'Main assembly',
  modelId: 'assembly-model',
  status: 'loaded',
  children: [
    { id: 'bolt-1', name: 'Bolt instance 1', modelId: 'bolt', status: 'loaded', children: [] },
    { id: 'bolt-2', name: 'Bolt instance 2', modelId: 'bolt', status: 'readonly', children: [] },
    { id: 'missing', name: 'Unavailable part', modelId: null, status: 'unloaded', children: [] },
    {
      id: 'nested',
      name: 'Nested assembly',
      modelId: 'nested-model',
      status: 'loaded',
      children: [
        {
          id: 'needle',
          name: 'Search needle',
          modelId: 'needle-model',
          status: 'loaded',
          children: [],
        },
      ],
    },
  ],
}

function render(overrides: Partial<AssemblyTreeProps> = {}) {
  return renderToStaticMarkup(
    <AssemblyTree
      root={root}
      query=""
      focusedModelId={null}
      collapsedIds={new Set()}
      onToggle={vi.fn()}
      onLocate={vi.fn()}
      {...overrides}
    />,
  )
}

function itemTags(html: string) {
  return html.match(/<div role="treeitem"[^>]*>/g) ?? []
}

describe('assembly occurrence tree', () => {
  it('renders one root row with children grouped beneath it, not a duplicate title row', () => {
    const html = render()
    expect(html.match(/role="tree"/g)).toHaveLength(1)
    expect(html.match(/class="tree-row /g)).toHaveLength(6)
    expect(html.match(/<span title="Main assembly">Main assembly<\/span>/g)).toHaveLength(1)
    expect(itemTags(html)).toHaveLength(6)
    expect(itemTags(html)[0]).toContain('aria-level="1" aria-expanded="true"')
    expect(html.match(/role="group"/g)).toHaveLength(2)
    expect(html).toContain('Bolt instance 1')
  })

  it('uses an assembly icon for an empty root and omits leaf expansion state', () => {
    const html = render({ root: { ...root, children: [] } })
    expect(html).toContain('lucide-boxes')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('role="group"')
  })

  it('honors collapsed branches without duplicating or rendering their children', () => {
    const html = render({ collapsedIds: new Set(['root']) })
    expect(itemTags(html)).toHaveLength(1)
    expect(itemTags(html)[0]).toContain('aria-expanded="false"')
    expect(html).not.toContain('Bolt instance 1')
    expect(html).not.toContain('role="group"')
  })

  it('expands matching descendant paths during search despite controlled collapse state', () => {
    const html = render({ query: 'NEEDLE', collapsedIds: new Set(['root', 'nested']) })
    expect(itemTags(html)).toHaveLength(3)
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2)
    expect(html).toContain('Main assembly')
    expect(html).toContain('Nested assembly')
    expect(html).toContain('Search needle')
    expect(html).not.toContain('Bolt instance')
  })

  it('does not select null-model nodes when no model is focused', () => {
    const html = render()
    expect(html).not.toContain('aria-selected="true"')
    expect(html).not.toContain('tree-row chosen')
    expect(html).toMatch(/class="tree-label" title="Unavailable part" disabled=""/)
  })

  it('selects only the focused occurrence when siblings share the same model', () => {
    const html = render({ focusedModelId: 'bolt', focusedOccurrenceId: 'bolt-2' })
    const selected = itemTags(html).filter((tag) => tag.includes('aria-selected="true"'))
    expect(selected).toHaveLength(1)
    expect(selected[0]).toContain('aria-label="Bolt instance 2"')
    expect(html.match(/tree-row chosen/g)).toHaveLength(1)
  })

  it('keeps legacy model selection when occurrence focus is omitted', () => {
    const html = render({ focusedModelId: 'bolt' })
    expect(html.match(/aria-selected="true"/g)).toHaveLength(2)
  })

  it('can explicitly clear occurrence selection without selecting null-model rows', () => {
    expect(render({ focusedModelId: 'bolt', focusedOccurrenceId: null })).not.toContain(
      'aria-selected="true"',
    )
    expect(render({ focusedOccurrenceId: 'missing' })).not.toContain('aria-selected="true"')
  })

  it('exposes complete long names and read-only status through tooltips', () => {
    const name = 'A very long assembly name that must remain available when the row is truncated'
    const html = render({ root: { ...root, name, status: 'readonly', children: [] } })
    expect(html).toContain(`class="tree-label" title="${name}"`)
    expect(html).toContain(`<span title="${name}">${name}</span>`)
    expect(html).toContain('title="只读" aria-label="只读"')
  })
})
