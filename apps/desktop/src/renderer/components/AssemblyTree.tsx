import { Box, Boxes, ChevronDown, ChevronRight, LockKeyhole } from 'lucide-react'
import type { Occurrence } from '../types'
import { matchesOccurrence } from '../editing'

export interface AssemblyTreeProps {
  root: Occurrence
  query: string
  focusedModelId: string | null
  /** When supplied, select one occurrence rather than every instance of its model. */
  focusedOccurrenceId?: string | null
  collapsedIds: ReadonlySet<string>
  onToggle: (occurrenceId: string) => void
  onLocate: (modelId: string | null, occurrenceId?: string) => void
}

/** Controlled occurrence tree: the workbench retains search, location and expansion state. */
export function AssemblyTree(props: AssemblyTreeProps) {
  return (
    <div role="tree" aria-label="装配结构">
      <OccurrenceRow {...props} node={props.root} depth={0} />
    </div>
  )
}

function OccurrenceRow({
  node,
  depth,
  ...props
}: AssemblyTreeProps & { node: Occurrence; depth: number }) {
  if (!matchesOccurrence(node, props.query)) return null
  const hasChildren = node.children.length > 0
  const expanded = !!props.query || !props.collapsedIds.has(node.id)
  const selected =
    node.modelId !== null &&
    (props.focusedOccurrenceId !== undefined
      ? props.focusedOccurrenceId === node.id
      : props.focusedModelId === node.modelId)
  return (
    <div
      role="treeitem"
      aria-label={node.name}
      aria-level={depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
    >
      <div
        className={`tree-row ${selected ? 'chosen' : ''}`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <button
          className="tree-arrow"
          aria-label={`${expanded ? '折叠' : '展开'} ${node.name}`}
          type="button"
          disabled={!hasChildren}
          onClick={() => props.onToggle(node.id)}
        >
          {node.children.length ? (
            expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : null}
        </button>
        <button
          type="button"
          className="tree-label"
          title={node.name}
          disabled={node.modelId === null}
          onClick={() => {
            if (node.modelId !== null) props.onLocate(node.modelId, node.id)
          }}
        >
          {depth === 0 || hasChildren ? <Boxes size={16} /> : <Box size={15} />}
          <span title={node.name}>{node.name}</span>
          {node.status === 'readonly' && (
            <span title="只读" aria-label="只读">
              <LockKeyhole size={11} aria-hidden="true" />
            </span>
          )}
        </button>
      </div>
      {hasChildren && expanded && (
        <div role="group">
          {node.children.map((child) => (
            <OccurrenceRow key={child.id} {...props} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
