import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssemblyTree, assemblyDepth } from './AssemblyTree'
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

function render(query = '', expandLevel?: number) {
  return renderToStaticMarkup(
    <AssemblyTree root={root} query={query} expandLevel={expandLevel} />,
  )
}

function itemTags(html: string) {
  return html.match(/<div role="treeitem"[^>]*>/g) ?? []
}

describe('read-only assembly occurrence tree', () => {
  it('renders the whole tree with only expand and collapse controls', () => {
    const html = render()
    expect(html.match(/role="tree"/g)).toHaveLength(1)
    expect(html).toContain('class="assembly-static-tree"')
    expect(itemTags(html)).toHaveLength(6)
    expect(html.match(/class="assembly-toggle"/g)).toHaveLength(2)
    expect(html).not.toContain('aria-selected')
    expect(html).not.toContain('tabindex')
  })

  it('shows child depth through nested indentation guides', () => {
    const html = render()
    expect(itemTags(html)[0]).toContain('aria-level="1"')
    expect(itemTags(html)[1]).toContain('aria-level="2"')
    expect(html.match(/class="assembly-children"/g)).toHaveLength(2)
  })

  it('reports the deepest level of the tree', () => {
    expect(assemblyDepth(root)).toBe(2)
    expect(assemblyDepth({ ...root, children: [] })).toBe(0)
  })

  it('collapses deeper levels with the expand-level preset', () => {
    const html = render('', 1)
    expect(html).toContain('Nested assembly')
    expect(html).not.toContain('Search needle')
    expect(itemTags(html)).toHaveLength(5)
  })

  it('marks unloaded occurrences instead of offering selection', () => {
    const html = render()
    expect(html).toContain('class="assembly-node-missing">未加载</span>')
    expect(html).toContain('Unavailable part')
  })

  it('highlights and filters matching branches while keeping ancestor context', () => {
    const html = render('NEEDLE')
    expect(html).toContain('assembly-node-hit')
    expect(html).toContain('Main assembly')
    expect(html).toContain('Nested assembly')
    expect(html).toContain('Search needle')
    expect(html).not.toContain('Bolt instance')
  })

  it('renders nothing when the query matches no occurrence', () => {
    const html = render('missing-name')
    expect(html).not.toContain('role="treeitem"')
  })
})
