import { useEffect, useMemo, useRef, useState } from 'react'
import { search, type SearchHit } from '../../core/search/query'
import { UNTITLED, type DocId } from '../../core/model/types'
import { dailyNoteTitle, findDailyNote } from '../../core/model/daily'
import { newCollection } from '../../core/model/collection'
import { newId, type JsonValue } from '../../core/model/types'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { Icon } from '../design/Icon'

/**
 * The command palette.
 *
 * One entry point for both things people want from a keyboard: reaching a page
 * they can half-remember, and running an action without hunting for its button.
 * Mixing them in one list is deliberate — asking someone to know in advance
 * whether "today" is a page or a command is asking them to model the software.
 *
 * Results come from the index, so opening the palette decrypts nothing.
 */

type Entry =
  | { kind: 'doc'; id: DocId; label: string; hint: string }
  | { kind: 'action'; id: string; label: string; hint: string; run: () => Promise<void> | void }

export function CommandPalette({
  open,
  onClose,
  onOpenDoc,
}: {
  open: boolean
  onClose: () => void
  onOpenDoc: (id: DocId) => void
}) {
  const vault = useVault()
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

  const entries = useMemo<Entry[]>(() => {
    const hits = search(index, query, 12)
    const docs: Entry[] = hits.map((hit) => ({
      kind: 'doc',
      id: hit.doc.id,
      label: hit.doc.title || UNTITLED,
      hint: hintFor(hit),
    }))

    const actions: Entry[] = [
      {
        kind: 'action',
        id: 'new',
        label: query.trim() === '' ? 'New page' : `Create page “${query.trim()}”`,
        hint: 'Action',
        run: async () => {
          const created = await vault.createDoc(query.trim() === '' ? {} : { title: query.trim() })
          onOpenDoc(created.id)
        },
      },
      {
        kind: 'action',
        id: 'database',
        label: query.trim() === '' ? 'New database' : `Create database “${query.trim()}”`,
        hint: 'Action',
        run: async () => {
          const created = await vault.createDoc(query.trim() === '' ? {} : { title: query.trim() })
          // A database is a document whose content has a different shape, so
          // it is created and then given that shape — no special store.
          await vault.saveDoc(created.id, {
            content: newCollection(newId) as unknown as JsonValue,
          })
          onOpenDoc(created.id)
        },
      },
      {
        kind: 'action',
        id: 'daily',
        label: `Today’s note — ${dailyNoteTitle()}`,
        hint: 'Action',
        run: async () => {
          // Reuse today's note when it exists, so the command is idempotent.
          const existing = findDailyNote(index)
          const doc = existing ?? (await vault.createDoc({ title: dailyNoteTitle() }))
          onOpenDoc(doc.id)
        },
      },
    ]

    return [...docs, ...actions]
  }, [index, query, vault, onOpenDoc])

  const choose = async (entry: Entry) => {
    onClose()
    if (entry.kind === 'doc') onOpenDoc(entry.id)
    else await entry.run()
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Search and commands"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
      className="mx-auto mt-[12vh] w-[min(38rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-0 text-ink shadow-modal backdrop:bg-black/35"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Icon name="page" className="size-4 shrink-0 text-ink-faint" />
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
              setActive((current) => Math.min(current + 1, entries.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((current) => Math.max(current - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const entry = entries[active]
              if (entry) void choose(entry)
            }
          }}
          placeholder="Search pages, or type a command…"
          aria-label="Search pages"
          className="h-12 w-full border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      <ul className="max-h-80 overflow-y-auto p-1.5">
        {entries.map((entry, position) => (
          <li key={`${entry.kind}:${entry.id}`}>
            <button
              type="button"
              // `mousemove` rather than `mouseenter`: the pointer often sits
              // where the list will appear, and an enter event that never
              // fires would leave the highlight out of step with the cursor.
              onMouseMove={() => setActive(position)}
              onClick={() => void choose(entry)}
              className={[
                'flex w-full items-baseline justify-between gap-4 rounded-sm px-2.5 py-2 text-left text-sm',
                position === active ? 'bg-accent-soft text-ink' : 'text-ink-muted',
              ].join(' ')}
            >
              <span className="min-w-0 truncate">{entry.label}</span>
              <span className="shrink-0 text-2xs text-ink-faint">{entry.hint}</span>
            </button>
          </li>
        ))}

        {entries.length === 0 && (
          <li className="px-2.5 py-6 text-center text-sm text-ink-faint">Nothing matches.</li>
        )}
      </ul>
    </dialog>
  )
}

function hintFor(hit: SearchHit): string {
  if (hit.matched === 'title') return 'Page'
  if (hit.matched === 'tag') return 'Tag'
  return 'In the text'
}
