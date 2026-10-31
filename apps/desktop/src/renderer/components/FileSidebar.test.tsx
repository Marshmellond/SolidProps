import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useState } from 'react'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: vi.fn(actual.useState) }
})
import {
  FileSidebar,
  buildFileSidebarEntries,
  filterFileSidebarEntries,
  setFileSidebarSelection,
  type FileSidebarProps,
} from './FileSidebar'
import type { Model, Snapshot } from '../types'

function model(id: string, name: string, path = `C:\\models\\${name}`): Model {
  return {
    id,
    name,
    path,
    kind: 'part',
    configuration: '',
    scope: 'document',
    properties: [],
    writable: true,
    reason: '',
    dirty: false,
  }
}

const snapshot: Snapshot = {
  id: 'snapshot',
  sessionId: 'session',
  title: 'Assembly',
  cadId: 'test',
  scope: 'document',
  warnings: [],
  models: [
    model('bolt-b', '螺栓.prt', 'C:\\supplier-b\\螺栓.prt'),
    model('root-model', '总装.asm'),
    model('cover', '盖板.prt'),
    model('bolt-a', '螺栓.prt', 'C:\\supplier-a\\螺栓.prt'),
    model('unused', '未引用.prt'),
  ],
  root: {
    id: 'root',
    name: 'Root assembly',
    modelId: 'root-model',
    status: 'loaded',
    children: [
      { id: 'bolt-1', name: 'Bolt 1', modelId: 'bolt-a', status: 'loaded', children: [] },
      { id: 'bolt-2', name: 'Bolt 2', modelId: 'bolt-a', status: 'loaded', children: [] },
      { id: 'missing', name: 'Missing', modelId: null, status: 'unloaded', children: [] },
      {
        id: 'cover-instance',
        name: 'Cover',
        modelId: 'cover',
        status: 'loaded',
        children: [
          { id: 'bolt-3', name: 'Bolt 3', modelId: 'bolt-b', status: 'loaded', children: [] },
          {
            id: 'stale',
            name: 'Stale',
            modelId: 'not-in-models',
            status: 'unloaded',
            children: [],
          },
        ],
      },
    ],
  },
}

function render(overrides: Partial<FileSidebarProps> = {}) {
  return renderToStaticMarkup(
    <FileSidebar
      snapshot={snapshot}
      selected={new Set()}
      onSelectionChange={vi.fn()}
      {...overrides}
    />,
  )
}

describe('FileSidebar file projection', () => {
  it('puts the root model first, followed by Chinese locale names and stable path order', () => {
    const entries = buildFileSidebarEntries(snapshot)
    expect(entries[0].model.id).toBe('root-model')
    const remaining = entries.slice(1).map(({ model }) => model)
    expect(remaining).toEqual(
      [...snapshot.models.filter((item) => item.id !== 'root-model')].sort(
        (a, b) => a.name.localeCompare(b.name, 'zh') || a.path.localeCompare(b.path, 'zh'),
      ),
    )
    expect(entries.filter((entry) => entry.isRoot)).toHaveLength(1)
  })

  it('uses existing unique model IDs, retaining distinct files with identical names', () => {
    const entries = buildFileSidebarEntries({
      ...snapshot,
      models: [...snapshot.models, snapshot.models[0]],
    })
    expect(entries).toHaveLength(snapshot.models.length)
    expect(entries.map(({ model }) => model.id)).not.toContain('not-in-models')
    expect(entries.filter(({ model }) => model.name === '螺栓.prt')).toHaveLength(2)
  })

  it('counts nested references but excludes the root occurrence and missing models', () => {
    const counts = Object.fromEntries(
      buildFileSidebarEntries(snapshot).map((entry) => [entry.model.id, entry.referenceCount]),
    )
    expect(counts).toEqual({ 'root-model': 0, 'bolt-a': 2, 'bolt-b': 1, cover: 1, unused: 0 })
  })

  it('counts a real child reference back to the root model, without counting the root itself', () => {
    const repeatedRoot = {
      ...snapshot,
      root: { ...snapshot.root, children: [{ ...snapshot.root, id: 'child-root', children: [] }] },
    }
    expect(
      buildFileSidebarEntries(repeatedRoot).find((entry) => entry.isRoot)?.referenceCount,
    ).toBe(1)
  })

  it('marks duplicate names and derives parent directories for Windows and slash paths', () => {
    const entries = buildFileSidebarEntries(snapshot)
    expect(entries.find(({ model }) => model.id === 'bolt-a')).toMatchObject({
      duplicateName: true,
      parentDirectory: 'C:\\supplier-a',
    })
    expect(entries.find(({ model }) => model.id === 'cover')?.duplicateName).toBe(false)
    const slash = buildFileSidebarEntries({
      ...snapshot,
      models: [model('slash', 'part.prt', '/models/vendor/part.prt')],
    })
    expect(slash[0].parentDirectory).toBe('/models/vendor')
  })

  it('searches case-insensitive names and full paths, trimming whitespace', () => {
    const entries = buildFileSidebarEntries(snapshot)
    expect(filterFileSidebarEntries(entries, ' SUPPLIER-A ').map(({ model }) => model.id)).toEqual([
      'bolt-a',
    ])
    expect(filterFileSidebarEntries(entries, '螺栓')).toHaveLength(2)
    expect(filterFileSidebarEntries(entries, ' ')).toHaveLength(entries.length)
    expect(filterFileSidebarEntries(entries, 'not-a-file')).toEqual([])
  })

  it('does not mutate the snapshot or its model order', () => {
    const before = JSON.stringify(snapshot)
    buildFileSidebarEntries(snapshot)
    expect(JSON.stringify(snapshot)).toBe(before)
  })
})

describe('FileSidebar selection helpers', () => {
  it('selects or clears visible files while preserving hidden selection and the input set', () => {
    const selected = new Set(['hidden', 'visible-a'])
    expect(setFileSidebarSelection(selected, ['visible-a', 'visible-b'], true)).toEqual(
      new Set(['hidden', 'visible-a', 'visible-b']),
    )
    expect(setFileSidebarSelection(selected, ['visible-a', 'visible-b'], false)).toEqual(
      new Set(['hidden']),
    )
    expect(selected).toEqual(new Set(['hidden', 'visible-a']))
  })

  it('clears only hidden selections and returns an independent Set even for no changes', () => {
    const selected = new Set(['hidden', 'visible'])
    expect(setFileSidebarSelection(selected, ['hidden'], false)).toEqual(new Set(['visible']))
    expect(setFileSidebarSelection(selected, [], true)).not.toBe(selected)
  })
})

function renderSidebarState(
  state: {
    view: 'files' | 'structure'
    fileQuery?: string
    structureQuery?: string
    focusedOccurrence?: string | null
  },
  overrides: Partial<FileSidebarProps> = {},
) {
  // SSR has no event loop/DOM; seed local state to verify each view's rendering contract.
  for (const value of [
    state.view,
    state.fileQuery ?? '',
    state.structureQuery ?? '',
    state.focusedOccurrence ?? null,
    new Set<string>(),
  ]) {
    vi.mocked(useState).mockReturnValueOnce([value, vi.fn()])
  }
  return render(overrides)
}

describe('FileSidebar server rendering', () => {
  it('defaults to the files tab with accessible search, multiple selection, and a clear action', () => {
    const html = render()
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>文件<\/button>/)
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>装配结构<\/button>/)
    expect(html).toContain('aria-label="搜索文件名或路径"')
    expect(html).toContain('aria-label="全选当前可见文件"')
    expect(html).toContain('清空选择')
    expect(html).not.toContain('role="tree"')
    expect(html.match(/type="checkbox"/g)).toHaveLength(snapshot.models.length + 1)
    expect(html).toContain('已选 0 / 5 个文件')
  })

  it('renders root first and each file once, with duplicate parent directories and full path tooltips', () => {
    const html = render()
    const buttons = [...html.matchAll(/class="file-sidebar-file" title="([^"]*)"/g)].map(
      (match) => match[1],
    )
    expect(buttons).toEqual(buildFileSidebarEntries(snapshot).map(({ model }) => model.path))
    expect(html).toContain('class="file-sidebar-directory">C:\\supplier-a</span>')
    expect(html).toContain('class="file-sidebar-directory">C:\\supplier-b</span>')
    expect(html.match(/class="file-sidebar-root"/g)).toHaveLength(1)
    expect(html).not.toContain('Missing')
    expect(html).not.toContain('Stale')
  })

  it('shows a repeated-reference badge only when count exceeds one', () => {
    const html = render()
    expect(html).toContain('aria-label="装配引用 2 次">×2</span>')
    expect(html.match(/class="file-sidebar-references"/g)).toHaveLength(1)
    expect(html).not.toContain('×1')
    expect(html).not.toContain('×0')
  })

  it('renders checked files, mixed visible selection, and draft dirty markers', () => {
    const html = render({
      selected: new Set(['bolt-a', 'cover']),
      dirtyModelIds: new Set(['bolt-a']),
    })
    expect(html).toContain('aria-checked="mixed"')
    expect(html.match(/ checked=""/g)).toHaveLength(2)
    expect(html.match(/file-sidebar-row-selected/g)).toHaveLength(2)
    expect(html).toContain('已选 2 / 5 个文件')
    expect(html.match(/class="file-sidebar-dirty"/g)).toHaveLength(1)
    expect(html).toContain('title="有待提交变更" aria-label="有待提交变更"')
  })

  it('checks the select-all box only when every existing file is selected', () => {
    const html = render({ selected: new Set(snapshot.models.map(({ id }) => id)) })
    expect(html).toContain('aria-checked="true"')
    expect(html.match(/ checked=""/g)).toHaveLength(snapshot.models.length + 1)
  })

  it('keeps navigation and search available while busy but disables file selection', () => {
    const onSelectionChange = vi.fn()
    const html = render({ disabled: true, selected: new Set(['bolt-a']), onSelectionChange })
    const tabs = html.match(/<button\b[^>]*role="tab"[^>]*>/g) ?? []
    expect(tabs).toHaveLength(2)
    expect(tabs.every((control) => !control.includes('disabled=""'))).toBe(true)
    expect(html).toMatch(/<input type="search"(?![^>]*disabled)[^>]*>/)
    const selectionControls =
      html.match(/<(?:button|input)\b[^>]*(?:type="checkbox"|class="file-sidebar-file")[^>]*>/g) ??
      []
    expect(selectionControls).toHaveLength(snapshot.models.length * 2 + 1)
    expect(selectionControls.every((control) => control.includes('disabled=""'))).toBe(true)
    expect(html).toContain('已选 1 / 5 个文件')
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('uses independent search text for each view and preserves selected files', () => {
    const onSelectionChange = vi.fn()
    const selected = new Set(['bolt-a', 'cover'])
    const queries = { fileQuery: 'supplier-a', structureQuery: 'Cover' }
    const structure = renderSidebarState(
      { ...queries, view: 'structure' },
      { selected, onSelectionChange },
    )
    expect(structure).toContain(
      'aria-label="搜索装配结构" placeholder="搜索装配结构" value="Cover"',
    )
    expect(structure).toContain('role="treeitem" aria-label="Cover"')
    expect(structure).not.toContain('role="treeitem" aria-label="Bolt 1"')
    const files = renderSidebarState({ ...queries, view: 'files' }, { selected, onSelectionChange })
    expect(files).toContain('value="supplier-a"')
    expect(files).toContain('已选 2 / 5 个文件')
    expect(files).toContain('搜索隐藏了 1 个已选文件')
    expect(files).toContain('C:\\supplier-a\\螺栓.prt')
    expect(files).not.toContain('C:\\supplier-b\\螺栓.prt')
    expect(selected).toEqual(new Set(['bolt-a', 'cover']))
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('renders structure without explanatory paragraphs or reference hints', () => {
    const html = renderSidebarState({ view: 'structure' }, { selected: new Set(['bolt-a']) })
    expect(html).toContain('role="tree"')
    expect(html).not.toContain('点击实例可定位文件')
    expect(html).not.toContain('所选文件被引用')
    expect(html).not.toContain('file-sidebar-structure-note')
    expect(html).not.toContain('file-sidebar-reference-note')
    expect(html).not.toMatch(/role="treeitem"[^>]*aria-selected="true"/)
  })

  it('highlights only the located occurrence, and rejects stale focus after selection or snapshot changes', () => {
    const state = { view: 'structure' as const, focusedOccurrence: 'bolt-2' }
    const located = renderSidebarState(state, { selected: new Set(['bolt-a']) })
    expect(located).toContain('aria-label="Bolt 2" aria-level="2" aria-selected="true"')
    expect(located).toContain('aria-label="Bolt 1" aria-level="2" aria-selected="false"')
    for (const selected of [new Set(['cover']), new Set(['bolt-a', 'cover']), new Set<string>()]) {
      const html = renderSidebarState(state, { selected })
      expect(html).not.toMatch(/role="treeitem"[^>]*aria-selected="true"/)
    }
    const refreshed = renderSidebarState(state, {
      selected: new Set(['bolt-a']),
      snapshot: { ...snapshot, root: { ...snapshot.root, children: [] } },
    })
    expect(refreshed).not.toMatch(/role="treeitem"[^>]*aria-selected="true"/)
  })

  it('handles an empty snapshot without rendering phantom root files', () => {
    const html = render({ snapshot: { ...snapshot, models: [] } })
    expect(html).toContain('没有可用文件')
    expect(html).toContain('全选可见 (0)')
    expect(html).toContain('aria-label="全选当前可见文件" aria-checked="false" disabled=""')
    expect(html).not.toContain('class="file-sidebar-row')
  })
})
