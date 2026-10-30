import { Pencil, Save, Send, X } from 'lucide-react'

export interface EditActionsProps {
  editing: boolean
  hideStart?: boolean
  canStart: boolean
  busy: boolean
  locked: boolean
  changeCount: number
  onStart: () => void
  onSave: () => void
  onCancel: () => void
  canSaveEmpty?: boolean
  saved?: boolean
  onSubmit?: () => void
}

export function EditActions(props: EditActionsProps) {
  if (!props.editing)
    return (
      <>
        {!props.hideStart && (
          <button
            className="button primary"
            data-testid="edit-properties"
            disabled={!props.canStart || props.busy || props.locked}
            onClick={props.onStart}
          >
            <Pencil size={15} />
            编辑
          </button>
        )}
        <button
          className="button primary"
          data-testid="submit-changes"
          disabled={!props.saved || !props.changeCount || props.busy || props.locked}
          onClick={props.onSubmit}
        >
          <Send size={15} />
          提交{props.changeCount > 0 && <b>{props.changeCount}</b>}
        </button>
      </>
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
        data-testid="save-draft"
        disabled={(!props.changeCount && !props.canSaveEmpty) || props.busy || props.locked}
        onClick={props.onSave}
      >
        <Save size={15} />
        保存{props.changeCount > 0 && <b>{props.changeCount}</b>}
      </button>
    </>
  )
}
