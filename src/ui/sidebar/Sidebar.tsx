import { useState } from 'react'
import type { DocId, DocSummary } from '../../core/model/types'
import { UNTITLED } from '../../core/model/types'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { childrenOf, descendantIdsOf } from '../../core/model/tree'
import { Button, IconButton } from '../design/Button'
import { Icon } from '../design/Icon'
import { ConfirmDialog } from '../design/ConfirmDialog'

/**
 * The page tree.
 *
 * Every row is a button, not a clickable `<div>`: keyboard navigation and
 * screen-reader announcements depend on it. The disclosure chevron is a
 * separate control from the row, otherwise expanding a branch would also
 * change the page on screen.
 *
 * A column on a wide screen, a drawer on a narrow one. 16rem is a quarter of a
 * laptop and two thirds of a phone: at 390px it left the page itself 134px, a
 * column about four words wide, which is not a small version of the notebook
 * but a broken one. Below `md` it slides over the page instead, and closes as
 * soon as it has done its job — you opened it to go somewhere.
 */
export function Sidebar({
  openId,
  onOpen,
  open,
  onClose,
}: {
  openId: DocId | null
  onOpen: (id: DocId | null) => void
  /** Whether the drawer is showing. Ignored from `md` up, where it is a column. */
  open: boolean
  onClose: () => void
}) {
  const vault = useVault()
  const index = useVaultIndex()
  const [expanded, setExpanded] = useState<ReadonlySet<DocId>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<DocSummary | null>(null)

  const roots = childrenOf(index, null)

  const toggle = (id: DocId) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const createChild = async (parentId: DocId | null) => {
    const created = await vault.createDoc({ parentId })
    if (parentId) setExpanded((current) => new Set(current).add(parentId))
    onOpen(created.id)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const removed = await vault.deleteDoc(pendingDelete.id)
    setPendingDelete(null)
    // If the open page has just disappeared, the editor must be cleared rather
    // than show a document that no longer exists.
    if (openId && removed.includes(openId)) onOpen(null)
  }

  const descendantCount = pendingDelete ? descendantIdsOf(index, pendingDelete.id).length : 0

  /** Going somewhere is what the drawer was opened for, so it closes behind you. */
  const openAndClose = (id: DocId | null) => {
    onOpen(id)
    onClose()
  }

  return (
    <>
      {/*
        The backdrop belongs to the drawer, not to the page: without something
        to press, a drawer opened by accident on a phone can only be closed by
        finding the same small button again.
      */}
      <button
        type="button"
        aria-label="Close the page list"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={[
          'fixed inset-0 z-30 bg-ink/20 backdrop-blur-[1px] transition-opacity duration-(--nook-dur-fast) ease-nook md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      <nav
        aria-label="Pages"
        className={[
          'flex h-full w-(--nook-sidebar-width) shrink-0 flex-col border-r border-line bg-sunken',
          // Narrow: a sheet over the page, moved rather than unmounted so the
          // scroll position and the expanded branches survive being closed.
          'fixed inset-y-0 left-0 z-40 transition-transform duration-(--nook-dur) ease-nook',
          // `invisible` and not merely off-screen: a drawer left in the tab
          // order is a dozen page buttons a keyboard walks through before
          // reaching the page it is meant to be editing, and a screen reader
          // reads out a list nobody opened.
          open ? 'translate-x-0' : 'invisible -translate-x-full',
          // Wide: the column it has always been.
          'md:visible md:static md:z-auto md:translate-x-0 md:transition-none',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-sm font-semibold tracking-tight">Nook</span>
          <div className="flex items-center gap-1">
            <IconButton label="New page" size="sm" onClick={() => void createChild(null)}>
              <Icon name="plus" />
            </IconButton>
            <IconButton
              label="Close the page list"
              size="sm"
              className="md:hidden"
              onClick={onClose}
            >
              <Icon name="sidebar" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {roots.length === 0 ? (
            <EmptySidebar onCreate={() => void createChild(null)} />
          ) : (
            <ul className="space-y-px">
              {roots.map((doc) => (
                <TreeRow
                  key={doc.id}
                  doc={doc}
                  depth={0}
                  openId={openId}
                  expanded={expanded}
                  onToggle={toggle}
                  onOpen={openAndClose}
                  onCreateChild={createChild}
                  onDelete={setPendingDelete}
                />
              ))}
            </ul>
          )}
        </div>
      </nav>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this page?"
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          “{pendingDelete?.title || UNTITLED}”
          {descendantCount > 0 && (
            <>
              {' '}
              and the {descendantCount} page{descendantCount > 1 ? 's' : ''} inside it
            </>
          )}{' '}
          will be deleted permanently. This action cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  )
}

function EmptySidebar({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-xs text-ink-muted">No pages yet.</p>
      <Button tone="primary" size="sm" className="mt-3" onClick={onCreate}>
        Create the first one
      </Button>
    </div>
  )
}

function TreeRow({
  doc,
  depth,
  openId,
  expanded,
  onToggle,
  onOpen,
  onCreateChild,
  onDelete,
}: {
  doc: DocSummary
  depth: number
  openId: DocId | null
  expanded: ReadonlySet<DocId>
  onToggle: (id: DocId) => void
  onOpen: (id: DocId) => void
  onCreateChild: (parentId: DocId) => void
  onDelete: (doc: DocSummary) => void
}) {
  const index = useVaultIndex()
  const children = childrenOf(index, doc.id)
  const isOpen = expanded.has(doc.id)
  const isCurrent = doc.id === openId

  return (
    <li>
      <div
        className={[
          'group flex items-center gap-0.5 rounded-sm pr-1 transition-colors duration-(--nook-dur-fast) ease-nook',
          isCurrent ? 'bg-accent-soft' : 'hover:bg-hover',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 0.75}rem` }}
      >
        {children.length > 0 ? (
          <IconButton
            label={isOpen ? 'Collapse' : 'Expand'}
            size="sm"
            onClick={() => onToggle(doc.id)}
          >
            <Icon
              name="chevron"
              className={`size-3.5 transition-transform duration-(--nook-dur-fast) ease-nook ${isOpen ? 'rotate-90' : ''}`}
            />
          </IconButton>
        ) : (
          <span className="size-6 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onOpen(doc.id)}
          aria-current={isCurrent ? 'page' : undefined}
          className={[
            'min-w-0 flex-1 truncate rounded-sm py-1 text-left text-sm',
            isCurrent ? 'font-medium text-ink' : 'text-ink-muted',
          ].join(' ')}
        >
          {doc.title || <span className="text-ink-faint">{UNTITLED}</span>}
        </button>

        {/*
Actions revealed on hover, but always reachable by keyboard:
            `focus-within` makes them visible as soon as one takes focus. 
*/}
        <span className="flex opacity-0 transition-opacity duration-(--nook-dur-fast) group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton
            label={`Add a page inside “${doc.title || UNTITLED}”`}
            size="sm"
            onClick={() => onCreateChild(doc.id)}
          >
            <Icon name="plus" className="size-3.5" />
          </IconButton>
          <IconButton
            label={`Delete “${doc.title || UNTITLED}”`}
            size="sm"
            onClick={() => onDelete(doc)}
          >
            <Icon name="trash" className="size-3.5" />
          </IconButton>
        </span>
      </div>

      {isOpen && children.length > 0 && (
        <ul className="space-y-px">
          {children.map((child) => (
            <TreeRow
              key={child.id}
              doc={child}
              depth={depth + 1}
              openId={openId}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
