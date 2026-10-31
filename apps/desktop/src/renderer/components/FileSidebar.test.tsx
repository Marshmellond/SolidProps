import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
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
    expect(html).toContain('aria-label="有未应用修改"')
  })

  it('checks the select-all box only when every existing file is selected', () => {
    const html = render({ selected: new Set(snapshot.models.map(({ id }) => id)) })
    expect(html).toContain('aria-checked="true"')
    expect(html.match(/ checked=""/g)).toHaveLength(snapshot.models.length + 1)
  })

  it('disables every control when disabled without changing selection or invoking callbacks during rendering', () => {
    const onSelectionChange = vi.fn()
    const html = render({ disabled: true, selected: new Set(['bolt-a']), onSelectionChange })
    const controls = html.match(/<(?:button|input)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((control) => control.includes('disabled=""'))).toBe(true)
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('handles an empty snapshot without rendering phantom root files', () => {
    const html = render({ snapshot: { ...snapshot, models: [] } })
    expect(html).toContain('没有可用文件')
    expect(html).toContain('全选可见 (0)')
    expect(html).toContain('aria-label="全选当前可见文件" aria-checked="false" disabled=""')
    expect(html).not.toContain('class="file-sidebar-row')
  })
})
