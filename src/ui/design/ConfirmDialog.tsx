import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

/**
 * Confirmation of a destructive action.
 *
 * Built on the native `<dialog>`, which gives — correctly, and for free —
 * focus trapping, Escape to close, an inert backdrop and the right semantics
 * for screen readers. Reimplementing all of that by hand is the shortcut that
 * produces modals nobody can use from a keyboard.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClick={(event) => {
        // A click on the backdrop closes. `<dialog>` receives the event for all of
        // the surface, backdrop included: we only close when the target is
        // the dialog itself, not an element inside it.
        if (event.target === ref.current) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-0 text-ink shadow-modal"
    >
      <div className="p-5">
        <h2 className="text-md font-semibold tracking-tight">{title}</h2>
        <div className="mt-2 text-sm text-ink-muted">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button onClick={onCancel}>Cancel</Button>
        <Button tone="danger" onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
