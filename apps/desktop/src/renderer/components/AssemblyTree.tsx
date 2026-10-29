import { Box, Boxes, ChevronDown, ChevronRight, LockKeyhole } from 'lucide-react'
import type { Occurrence } from '../types'
import { matchesOccurrence } from '../editing'

export interface AssemblyTreeProps {
  root: Occurrence
  query: string
  focusedModelId: string | null
  collapsedIds: ReadonlySet<string>
  onToggle: (occurrenceId: string) => void
  onLocate: (modelId: string | null) => void
}

/** Controlled occurrence tree: the workbench retains search, location and expansion state. */
export function AssemblyTree(props: AssemblyTreeProps) {
  return <OccurrenceRow {...props} node={props.root} depth={0} />
}

function OccurrenceRow({
  node,
  depth,
  ...props
}: AssemblyTreeProps & { node: Occurrence; depth: number }) {
  if (!matchesOccurrence(node, props.query)) return null
  const expanded = !!props.query || !props.collapsedIds.has(node.id)
  return (
    <div>
      <div
        className={`tree-row ${props.focusedModelId === node.modelId ? 'chosen' : ''}`}
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <button
          className="tree-arrow"
          aria-label={`${expanded ? '折叠' : '展开'} ${node.name}`}
          disabled={!node.children.length}
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
        <button className="tree-label" onClick={() => props.onLocate(node.modelId)}>
          {node.children.length ? <Boxes size={16} /> : <Box size={15} />}
          <span>{node.name}</span>
          {node.status === 'readonly' && <LockKeyhole size={11} />}
        </button>
      </div>
      {expanded &&
        node.children.map((child) => (
          <OccurrenceRow key={child.id} {...props} node={child} depth={depth + 1} />
        ))}
    </div>
  )
}
