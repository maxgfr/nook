/**
 * L'arbre des pages, en fonctions pures.
 *
 * Rien ici ne touche au disque : ces fonctions prennent un index et en
 * renvoient un nouveau. C'est ce qui rend l'ordre, les déplacements et les
 * suppressions en cascade testables en quelques millisecondes, sans base ni
 * navigateur.
 *
 * L'ordre entre frères est un simple nombre. Insérer entre deux voisins prend
 * le milieu, ce qui évite de réécrire toute la fratrie à chaque glisser-
 * déposer. Un nombre flottant finit par manquer de précision après une
 * cinquantaine d'insertions au même endroit : quand l'écart devient trop
 * petit, `renumber` réattribue des entiers propres à la fratrie. Le cas est
 * rare, mais il arrive, et il est silencieusement destructeur si on l'ignore.
 */

import type { DocId, DocSummary, VaultIndex } from './types'

/** En deçà, deux positions ne sont plus distinguables de façon fiable. */
const MIN_GAP = 1e-6

export function docOrThrow(index: VaultIndex, id: DocId): DocSummary {
  const doc = index.docs[id]
  if (!doc) throw new Error(`Document introuvable : ${id}`)
  return doc
}

export function childrenOf(index: VaultIndex, parentId: DocId | null): DocSummary[] {
  return Object.values(index.docs)
    .filter((doc) => doc.parentId === parentId)
    .toSorted((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
}

/** Du plus ancien ancêtre jusqu'au parent direct. */
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

/** Tous les descendants, en profondeur. N'inclut pas `id`. */
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
 * Déplace un document sous un nouveau parent, à la position demandée.
 *
 * @param position Rang souhaité parmi les frères, `undefined` pour la fin.
 * @throws si le déplacement créerait un cycle — glisser une page dans sa
 *   propre sous-arborescence détacherait toute la branche de l'arbre, et elle
 *   deviendrait invisible sans jamais être supprimée.
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
      throw new Error('Impossible de déplacer une page dans sa propre sous-arborescence.')
    }
  }

  const siblings = childrenOf(index, parentId).filter((sibling) => sibling.id !== id)
  const at = position === undefined ? siblings.length : clamp(position, 0, siblings.length)
  const before = siblings[at - 1]
  const after = siblings[at]

  const order = orderBetween(before?.order, after?.order)
  if (order !== null) return upsert(index, { ...doc, parentId, order })

  // Plus de place entre les deux voisins : on rattache d'abord la page au bon
  // parent, puis on réattribue des entiers propres à toute la fratrie.
  const rehomed = upsert(index, { ...doc, parentId, order: before?.order ?? 0 })
  return renumber(rehomed, parentId, id, at)
}

function orderBetween(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return (after as number) - 1
  if (after === undefined) return before + 1
  // Plus assez de place entre les deux : on demande une renumérotation.
  return after - before < MIN_GAP ? null : (before + after) / 2
}

/** Réattribue 0, 1, 2… à une fratrie, en insérant `id` au rang `at`. */
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
