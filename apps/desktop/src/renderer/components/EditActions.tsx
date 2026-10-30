import { Pencil, Save, X } from 'lucide-react'

export interface EditActionsProps {
  editing: boolean
  canStart: boolean
  busy: boolean
  locked: boolean
  changeCount: number
  onStart: () => void
  onSave: () => void
  onCancel: () => void
}

export function EditActions(props: EditActionsProps) {
  if (!props.editing)
    return (
      <button
        className="button primary"
        data-testid="edit-properties"
        disabled={!props.canStart || props.busy || props.locked}
        onClick={props.onStart}
      >
        <Pencil size={15} />
        编辑属性
      </button>
    )
  return (
    <>
      <button
        className="button"
        data-testid="cancel-edit"
        disabled={props.busy}
        onClick={props.onCancel}
      >
        <X size={15} />
        取消编辑
      </button>
      <button
        className="button primary"
        data-testid="preview-changes"
        disabled={!props.changeCount || props.busy || props.locked}
        onClick={props.onSave}
      >
        <Save size={15} />
        保存{props.changeCount > 0 && <b>{props.changeCount}</b>}
      </button>
    </>
  )
}
