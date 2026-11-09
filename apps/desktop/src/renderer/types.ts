export interface Session {
  id: string
  cadId: string
  label: string
  pid?: number
  version: string
  executable?: string
  connectable: boolean
  detail: string
}
export interface Diagnostic {
  cadId: string
  level: 'info' | 'warning' | 'error'
  message: string
}
export interface Capabilities {
  cadId: string
  displayName: string
  writable: boolean
  notes: string
}
export interface Property {
  name: string
  value: string
  valueType: string
  writable: boolean
  reason: string
  evaluated: string
}
export interface Model {
  id: string
  name: string
  path: string
  kind: 'assembly' | 'part'
  configuration: string
  scope: string
  properties: Property[]
  writable: boolean
  reason: string
  dirty: boolean
}
export interface Occurrence {
  id: string
  name: string
  modelId: string | null
  children: Occurrence[]
  status: string
}
export interface Snapshot {
  id: string
  sessionId: string
  title: string
  cadId: string
  scope: 'document' | 'configuration'
  models: Model[]
  root: Occurrence
  warnings: string[]
}
export interface Change {
  operation?: 'update' | 'add' | 'delete'
  modelId: string
  propertyName: string
  oldValue: string
  newValue: string
}
export interface WriteResult {
  modelId: string
  propertyName: string
  success: boolean
  message: string
  saved: boolean
  verified: boolean
}
export interface ApplyResult {
  results: WriteResult[]
  backupDirectory: string
}
export interface Bridge {
  request(method: string, params?: unknown): Promise<unknown>
  local(method: string, params?: unknown): Promise<unknown>
}
export type Page = 'workspace' | 'connections'
