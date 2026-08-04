import { backlinksOf, brokenLinksOf } from '../../core/search/query'
import { UNTITLED, type DocId } from '../../core/model/types'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { Button } from '../design/Button'

/**
 * What points here, and what points nowhere.
 *
 * Shown under the text rather than in a side panel: backlinks are something you
 * consult once you have finished reading, not while writing, and a permanent
 * panel would eat width from the one column that matters.
 *
 * Broken links are listed too. A `[[link]]` to a page that does not exist is
 * the normal way to plan a note you have not written yet — so it is offered as
 * a page to create, not reported as an error.
 */
export function Backlinks({ docId, onOpen }: { docId: DocId; onOpen: (id: DocId) => void }) {
  const vault = useVault()
  const index = useVaultIndex()

  const incoming = backlinksOf(index, docId)
  const broken = brokenLinksOf(index, docId)

  if (incoming.length === 0 && broken.length === 0) return null

  return (
    <section className="mt-16 border-t border-line pt-6">
      {incoming.length > 0 && (
        <>
          <h2 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            Linked from {incoming.length} page{incoming.length > 1 ? 's' : ''}
          </h2>
          <ul className="mt-2 space-y-px">
            {incoming.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onOpen(doc.id)}
                  className="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm text-ink-muted transition-colors duration-(--nook-dur-fast) ease-nook hover:bg-hover hover:text-ink"
                >
                  {doc.title || UNTITLED}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {broken.length > 0 && (
        <>
          <h2 className="mt-6 text-xs font-medium tracking-wide text-ink-faint uppercase">
            Not written yet
          </h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {broken.map((target) => (
              <li key={target}>
                <Button
                  size="sm"
                  className="border border-line"
                  onClick={() =>
                    void vault.createDoc({ title: target }).then((doc) => onOpen(doc.id))
                  }
                >
                  Create “{target}”
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
