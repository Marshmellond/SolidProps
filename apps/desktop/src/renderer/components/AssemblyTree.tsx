import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { matchesOccurrence } from '../editing'
import type { Occurrence } from '../types'

/** Deepest occurrence depth; a flat tree has depth 1 (root plus its children). */
export function assemblyDepth(root: Occurrence): number {
  if (root.children.length === 0) return 0
  return 1 + Math.max(...root.children.map(assemblyDepth))
}

export function AssemblyTree({
  root,
  query = '',
  expandLevel = Infinity,
}: {
  root: Occurrence
  query?: string
  expandLevel?: number
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  // A new level preset (or search) starts from a clean, predictable state.
  useEffect(() => setOverrides({}), [expandLevel, query])
  return (
    <div className="assembly-static-tree" role="tree" aria-label="装配结构">
      <StaticNode
        node={root}
        query={query}
        depth={0}
        expandLevel={expandLevel}
        overrides={overrides}
        onToggle={(id, open) => setOverrides((current) => ({ ...current, [id]: open }))}
      />
    </div>
  )
}

function StaticNode({
  node,
  query,
  depth,
  expandLevel,
  overrides,
  onToggle,
}: {
  node: Occurrence
  query: string
  depth: number
  expandLevel: number
  overrides: Record<string, boolean>
  onToggle: (id: string, open: boolean) => void
}) {
  if (!matchesOccurrence(node, query)) return null
  const hit = query !== '' && node.name.toLowerCase().includes(query.toLowerCase())
  const children = node.children.filter((child) => matchesOccurrence(child, query))
  const expandable = children.length > 0
  // Search results always open; otherwise the preset level applies until the user toggles a node.
  const open = query !== '' || (overrides[node.id] ?? depth < expandLevel)
  return (
    <div role="group" aria-label={node.name}>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={expandable ? open : undefined}
        aria-label={node.name}
        className={`assembly-node${hit ? ' assembly-node-hit' : ''}`}
      >
        {expandable ? (
          <button
            type="button"
            className="assembly-toggle"
            aria-label={`${open ? '收起' : '展开'} ${node.name}`}
            onClick={() => onToggle(node.id, !open)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="assembly-toggle-spacer" aria-hidden="true" />
        )}
        <span className={`assembly-node-dot${node.modelId !== null ? ' loaded' : ''}`} />
        <span className="assembly-node-name">{node.name}</span>
        {node.modelId === null && <span className="assembly-node-missing">未加载</span>}
      </div>
      {expandable && open && (
        <div className="assembly-children">
          {children.map((child) => (
            <StaticNode
              key={child.id}
              node={child}
              query={query}
              depth={depth + 1}
              expandLevel={expandLevel}
              overrides={overrides}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}
