import { useEffect, useMemo, useRef, useState } from 'react'
import { search } from '../../core/search/query'
import { UNTITLED, type DocId } from '../../core/model/types'
import { useVaultIndex } from '../app/VaultProvider'

/**
 * Choosing a page to embed.
 *
 * Deliberately not the command palette. That one mixes pages with actions,
 * which is right when you do not yet know whether "today" is a page or a
 * command, and wrong here: the only valid answer is a page, and offering to
 * create a database in the middle of choosing one would be noise.
 *
 * The search itself is the same function the palette uses, so a page found one
 * way is found the other, and the ranking cannot drift between them.
 */
export function PagePicker({
  open,
  exclude,
  onPick,
  onClose,
}: {
  open: boolean
  /** The page doing the embedding: it may not embed itself. */
  exclude: DocId
  onPick: (id: DocId) => void
  onClose: () => void
}) {
  const index = useVaultIndex()
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      setQuery('')
      setActive(0)
      element.showModal()
    }
    if (!open && element.open) element.close()
  }, [open])

  const results = useMemo(() => {
    const hits = search(index, query, 12).filter((hit) => hit.doc.id !== exclude)
    if (query.trim() !== '') return hits.map((hit) => hit.doc)

    // An empty field offers the pages touched most recently rather than
    // nothing. Someone embedding a page has usually just been in it.
    return Object.values(index.docs)
      .filter((doc) => doc.id !== exclude)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 12)
  }, [index, query, exclude])

  const choose = (id: DocId | undefined) => {
    if (!id) return
    onPick(id)
    onClose()
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Choose a page to embed"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-0 text-ink shadow-modal backdrop:bg-black/35"
    >
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((current) => Math.min(current + 1, results.length - 1))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => Math.max(current - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            choose(results[active]?.id)
          }
        }}
        placeholder="Which page?"
        aria-label="Search pages"
        className="h-11 w-full border-0 border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-ink-faint"
      />

      {results.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-faint">
          {query.trim() === '' ? 'There is no other page yet.' : 'No page matches that.'}
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto p-1">
          {results.map((doc, position) => (
            <li key={doc.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(position)}
                onClick={() => choose(doc.id)}
                className={[
                  'w-full truncate rounded-sm px-3 py-2 text-left text-sm transition-colors duration-(--nook-dur-fast) ease-nook',
                  position === active ? 'bg-hover text-ink' : 'text-ink-muted',
                ].join(' ')}
              >
                {doc.title || UNTITLED}
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  )
}
