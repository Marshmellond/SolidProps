import type { Occurrence } from './types'

export const cellKey = (modelId: string, propertyName: string) => `${modelId}\u0000${propertyName}`

export function matchesOccurrence(node: Occurrence, query: string): boolean {
  return (
    !query ||
    node.name.toLowerCase().includes(query.toLowerCase()) ||
    node.children.some((child) => matchesOccurrence(child, query))
  )
}
