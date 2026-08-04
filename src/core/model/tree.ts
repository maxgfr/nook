/**
 * The page tree, in pure functions.
 *
 * Nothing here touches the disk: these functions take an index and return a
 * new one. That is what makes ordering, moves and cascading deletes testable
 * in a few milliseconds, with no database and no browser.
 *
 * Order among siblings is a plain number. Inserting between two neighbours
 * takes the midpoint, which avoids rewriting the whole sibling list on every
 * drag. A floating-point number eventually runs out of precision after some
 * fifty insertions at the same spot: when the gap becomes too small,
 * `renumber` reassigns clean integers to the sibling list. The case is rare,
 * but it happens, and it is silently destructive if ignored.
 */

import type { DocId, DocSummary, VaultIndex } from './types'

/** Below this, two positions are no longer reliably distinguishable. */
const MIN_GAP = 1e-6

export function docOrThrow(index: VaultIndex, id: DocId): DocSummary {
  const doc = index.docs[id]
  if (!doc) throw new Error(`Document not found: ${id}`)
  return doc
}

export function childrenOf(index: VaultIndex, parentId: DocId | null): DocSummary[] {
  return Object.values(index.docs)
    .filter((doc) => doc.parentId === parentId)
    .toSorted((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
}

/** From the most distant ancestor down to the direct parent. */
export function ancestorsOf(index: VaultIndex, id: DocId): DocSummary[] {
  const chain: DocSummary[] = []
  const seen = new Set<DocId>([id])
  let parentId = index.docs[id]?.parentId ?? null

  while (parentId !== null && !seen.has(parentId)) {
    const parent = index.docs[parentId]
    if (!parent) break
    chain.unshift(parent)
    seen.add(parentId)
    parentId = parent.parentId
  }
  return chain
}

/** Every descendant, depth first. Does not include `id`. */
export function descendantIdsOf(index: VaultIndex, id: DocId): DocId[] {
  const out: DocId[] = []
  const queue: DocId[] = [id]
  const seen = new Set<DocId>([id])

  while (queue.length > 0) {
    const current = queue.pop() as DocId
    for (const child of childrenOf(index, current)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child.id)
      queue.push(child.id)
    }
  }
  return out
}

export function nextOrder(index: VaultIndex, parentId: DocId | null): number {
  const siblings = childrenOf(index, parentId)
  const last = siblings.at(-1)
  return last ? last.order + 1 : 0
}

export function upsert(index: VaultIndex, doc: DocSummary): VaultIndex {
  return { ...index, docs: { ...index.docs, [doc.id]: doc } }
}

export function removeAll(index: VaultIndex, ids: readonly DocId[]): VaultIndex {
  const docs = { ...index.docs }
  for (const id of ids) delete docs[id]
  return { ...index, docs }
}

/**
 * Moves a document under a new parent, at the requested position.
 *
 * @param position Desired rank among siblings, `undefined` for the end.
 * @throws if the move would create a cycle — dragging a page into its own
 *   subtree would detach the whole branch from the tree, and it would become
 *   invisible without ever being deleted.
 */
export function moveDoc(
  index: VaultIndex,
  id: DocId,
  parentId: DocId | null,
  position?: number,
): VaultIndex {
  const doc = docOrThrow(index, id)
  if (parentId !== null) {
    docOrThrow(index, parentId)
    if (parentId === id || descendantIdsOf(index, id).includes(parentId)) {
      throw new Error('A page cannot be moved into its own subtree.')
    }
  }

  const siblings = childrenOf(index, parentId).filter((sibling) => sibling.id !== id)
  const at = position === undefined ? siblings.length : clamp(position, 0, siblings.length)
  const before = siblings[at - 1]
  const after = siblings[at]

  const order = orderBetween(before?.order, after?.order)
  if (order !== null) return upsert(index, { ...doc, parentId, order })

  // No room left between the two neighbours: first reattach the page to the right
  // parent, then reassign clean integers to the whole sibling list.
  const rehomed = upsert(index, { ...doc, parentId, order: before?.order ?? 0 })
  return renumber(rehomed, parentId, id, at)
}

function orderBetween(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return (after as number) - 1
  if (after === undefined) return before + 1
  // Not enough room left between the two: we ask for a renumbering.
  return after - before < MIN_GAP ? null : (before + after) / 2
}

/** Reassigns 0, 1, 2… to a sibling list, inserting `id` at rank `at`. */
function renumber(index: VaultIndex, parentId: DocId | null, id: DocId, at: number): VaultIndex {
  const others = childrenOf(index, parentId).filter((sibling) => sibling.id !== id)
  const ordered = [...others.slice(0, at), docOrThrow(index, id), ...others.slice(at)]

  let result = index
  ordered.forEach((doc, rank) => {
    result = upsert(result, { ...doc, order: rank })
  })
  return result
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
