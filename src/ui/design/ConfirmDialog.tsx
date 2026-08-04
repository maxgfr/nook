import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

/**
 * Confirmation d'une action destructrice.
 *
 * Bâti sur `<dialog>` natif, ce qui donne gratuitement — et correctement — le
 * piégeage du focus, la fermeture par Échap, le fond inerte et la bonne
 * sémantique pour les lecteurs d'écran. Réimplémenter tout cela à la main est
 * le raccourci qui produit les modales inutilisables au clavier.
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
        // Un clic sur le fond ferme. `<dialog>` reçoit l'événement pour toute
        // la surface, y compris le backdrop : on ne ferme que si la cible est
        // le dialogue lui-même, pas un élément à l'intérieur.
        if (event.target === ref.current) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-0 text-ink shadow-modal backdrop:bg-black/35"
    >
      <div className="p-5">
        <h2 className="text-md font-semibold tracking-tight">{title}</h2>
        <div className="mt-2 text-sm text-ink-muted">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button onClick={onCancel}>Annuler</Button>
        <Button tone="danger" onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
