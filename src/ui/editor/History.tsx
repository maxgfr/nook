import { useEffect, useState } from 'react'
import type { DocId, Snapshot } from '../../core/model/types'
import { useVault } from '../app/VaultProvider'
import { Button } from '../design/Button'

/**
 * Past states of this page.
 *
 * Collapsed by default and empty until an edit has actually replaced
 * something: a history panel that is always open, always empty, teaches people
 * to stop looking at it.
 */
export function History({ docId }: { docId: DocId }) {
  const vault = useVault()
  const [open, setOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<readonly Snapshot[]>([])

  useEffect(() => {
    let cancelled = false
    void vault.history(docId).then((history) => {
      if (!cancelled) setSnapshots(history)
    })
    return () => {
      cancelled = true
    }
  }, [vault, docId, open])

  if (snapshots.length === 0) return null

  return (
    <section data-print-hide className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="text-xs font-medium tracking-wide text-ink-faint uppercase transition-colors duration-(--nook-dur-fast) ease-nook hover:text-ink"
      >
        {open ? 'Hide' : 'Show'} history ({snapshots.length})
      </button>

      {open && (
        <ul className="mt-2 space-y-px">
          {snapshots.map((snapshot) => (
            <li
              key={snapshot.at}
              className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-hover"
            >
              <time dateTime={snapshot.at} className="text-ink-muted">
                {new Date(snapshot.at).toLocaleString('en', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              <Button
                size="sm"
                onClick={() =>
                  void vault
                    .restore(docId, snapshot.at)
                    // Reloading is blunt, and it is honest: the editor holds
                    // its own copy of the document, so replacing the text
                    // underneath it would leave the two disagreeing.
                    .then(() => globalThis.location.reload())
                }
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
