import { useEffect, useState } from 'react'
import type { DocId, Snapshot } from '../../core/model/types'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { Button } from '../design/Button'

/**
 * Past versions of this page.
 *
 * Called "snapshots" rather than "history" throughout, so the list and the
 * button that adds to it share a word. "History" suggested something
 * continuous and complete; twenty kept versions are neither, and the name was
 * quietly promising more than the feature does.
 *
 * Collapsed by default and empty until something has actually been kept: a
 * panel that is always open and always empty teaches people to stop looking
 * at it.
 */
export function History({ docId }: { docId: DocId }) {
  const vault = useVault()
  const index = useVaultIndex()
  const [open, setOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<readonly Snapshot[]>([])

  /**
   * Re-read whenever this document is written, and only then.
   *
   * Snapshots live inside the encrypted document, so unlike backlinks or tags
   * they cannot be read off the index — this list has to be fetched, which
   * means it can go stale. It did: the effect used to depend only on the
   * document's identity, so a page that gained its first snapshot while open
   * kept showing nothing at all, and there was no control to press to correct
   * it because the panel hides itself when the list is empty. It came back on
   * the next reload, which reads exactly like a save that did not happen.
   *
   * `updatedAt` rather than the whole index: creating an unrelated page also
   * replaces the index, and this decrypts a document to answer.
   */
  const updatedAt = index.docs[docId]?.updatedAt

  useEffect(() => {
    let cancelled = false
    void vault.history(docId).then((history) => {
      if (!cancelled) setSnapshots(history)
    })
    return () => {
      cancelled = true
    }
  }, [vault, docId, updatedAt])

  if (snapshots.length === 0) return null

  return (
    <section data-print-hide className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="text-xs font-medium tracking-wide text-ink-faint uppercase transition-colors duration-(--nook-dur-fast) ease-nook hover:text-ink"
      >
        {open ? 'Hide' : 'Show'} snapshots ({snapshots.length})
      </button>

      {open && (
        <ul className="mt-2 space-y-px">
          {snapshots.map((snapshot) => (
            <li
              key={snapshot.at}
              className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-hover"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <time dateTime={snapshot.at} className="text-ink-muted">
                  {new Date(snapshot.at).toLocaleString('en', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
                {/*
                  Which ones you asked for, and which ones the clock filed.
                  Without it, the version you deliberately kept is
                  indistinguishable from the nineteen taken on a timer — and
                  the one you meant to come back to is the whole point.
                */}
                {snapshot.by === 'hand' && (
                  <span className="shrink-0 rounded-xs border border-line px-1 text-2xs text-ink-faint">
                    Kept by hand
                  </span>
                )}
              </span>
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
