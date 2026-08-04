import { useState } from 'react'
import type { DocId, DocSummary } from '../../core/model/types'
import { UNTITLED } from '../../core/model/types'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { childrenOf, descendantIdsOf } from '../../core/model/tree'
import { Button, IconButton } from '../design/Button'
import { Icon } from '../design/Icon'
import { ConfirmDialog } from '../design/ConfirmDialog'

/**
 * L'arbre des pages.
 *
 * Chaque ligne est un bouton, pas un `<div>` cliquable : la navigation au
 * clavier et l'annonce par les lecteurs d'écran en dépendent. Le chevron
 * d'ouverture est un contrôle distinct de la ligne, sinon déplier une branche
 * changerait aussi la page affichée.
 */
export function Sidebar({
  openId,
  onOpen,
}: {
  openId: DocId | null
  onOpen: (id: DocId | null) => void
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
    // Si la page ouverte vient de disparaître, l'éditeur doit être vidé plutôt
    // que d'afficher un document qui n'existe plus.
    if (openId && removed.includes(openId)) onOpen(null)
  }

  const descendantCount = pendingDelete ? descendantIdsOf(index, pendingDelete.id).length : 0

  return (
    <nav
      aria-label="Pages"
      className="flex h-full w-(--nook-sidebar-width) shrink-0 flex-col border-r border-line bg-sunken"
    >
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold tracking-tight">Nook</span>
        <IconButton label="Nouvelle page" size="sm" onClick={() => void createChild(null)}>
          <Icon name="plus" />
        </IconButton>
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
                onOpen={onOpen}
                onCreateChild={createChild}
                onDelete={setPendingDelete}
              />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Supprimer cette page ?"
        confirmLabel="Supprimer"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          « {pendingDelete?.title || UNTITLED} »
          {descendantCount > 0 && (
            <>
              {' '}
              et {descendantCount} page{descendantCount > 1 ? 's' : ''} qu'elle contient
            </>
          )}{' '}
          {descendantCount > 0 ? 'seront supprimées' : 'sera supprimée'} définitivement. Cette
          action ne peut pas être annulée.
        </p>
      </ConfirmDialog>
    </nav>
  )
}

function EmptySidebar({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-xs text-ink-muted">Aucune page pour l'instant.</p>
      <Button tone="primary" size="sm" className="mt-3" onClick={onCreate}>
        Créer la première
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
            label={isOpen ? 'Replier' : 'Déplier'}
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

        {/* Actions révélées au survol, mais toujours atteignables au clavier :
            `focus-within` les rend visibles dès que l'une reçoit le focus. */}
        <span className="flex opacity-0 transition-opacity duration-(--nook-dur-fast) group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton
            label={`Ajouter une page dans « ${doc.title || UNTITLED} »`}
            size="sm"
            onClick={() => onCreateChild(doc.id)}
          >
            <Icon name="plus" className="size-3.5" />
          </IconButton>
          <IconButton
            label={`Supprimer « ${doc.title || UNTITLED} »`}
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
