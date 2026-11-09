import { Info } from 'lucide-react'
import type { Capabilities, Session } from '../types'

export interface CompatibilityNoticeProps {
  session: Session | null
  capabilities: Capabilities | null
}

export function CompatibilityNotice({ session, capabilities }: CompatibilityNoticeProps) {
  if (!session || !capabilities || capabilities.writable || !capabilities.notes) return null
  return (
    <div className="notice compat" role="status">
      <Info size={15} />
      <span>{capabilities.notes}</span>
    </div>
  )
}
