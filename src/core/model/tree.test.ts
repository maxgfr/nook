import { describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  childrenOf,
  descendantIdsOf,
  docOrThrow,
  moveDoc,
  nextOrder,
  removeAll,
  upsert,
} from './tree'
import { EMPTY_INDEX, type DocId, type DocSummary, type VaultIndex } from './types'

function doc(id: DocId, parentId: DocId | null = null, order = 0): DocSummary {
  return {
    id,
    parentId,
    title: id,
    icon: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    order,
  }
}

function indexOf(...docs: DocSummary[]): VaultIndex {
  return docs.reduce(upsert, EMPTY_INDEX)
}

const ids = (docs: DocSummary[]) => docs.map((d) => d.id)

describe('page tree', () => {
  it('orders siblings by ascending rank', () => {
    const index = indexOf(doc('c', null, 2), doc('a', null, 0), doc('b', null, 1))

    expect(ids(childrenOf(index, null))).toEqual(['a', 'b', 'c'])
  })

  it('breaks a tie between siblings of equal order by creation date', () => {
    const index = indexOf(
      { ...doc('recent', null, 0), createdAt: '2026-06-01T00:00:00.000Z' },
      { ...doc('old', null, 0), createdAt: '2026-01-01T00:00:00.000Z' },
    )

    expect(ids(childrenOf(index, null))).toEqual(['old', 'recent'])
  })

  it('walks the ancestor chain, from the most distant down to the direct parent', () => {
    const index = indexOf(doc('racine'), doc('milieu', 'racine'), doc('feuille', 'milieu'))

    expect(ids(ancestorsOf(index, 'feuille'))).toEqual(['racine', 'milieu'])
    expect(ancestorsOf(index, 'racine')).toEqual([])
  })

  it('does not loop on a corrupted tree', () => {
    // A cycle should never exist, but a damaged index must not
    // freeze the application.
    const index = indexOf(doc('a', 'b'), doc('b', 'a'))

    expect(() => ancestorsOf(index, 'a')).not.toThrow()
    expect(ids(ancestorsOf(index, 'a')).length).toBeLessThanOrEqual(2)
  })

  it('collects the whole subtree, depth first', () => {
    const index = indexOf(
      doc('racine'),
      doc('enfant1', 'racine'),
      doc('enfant2', 'racine', 1),
      doc('petit', 'enfant1'),
    )

    expect(descendantIdsOf(index, 'racine').toSorted()).toEqual(['enfant1', 'enfant2', 'petit'])
    expect(descendantIdsOf(index, 'petit')).toEqual([])
  })

  it('places a new document after its siblings', () => {
    const index = indexOf(doc('a', null, 0), doc('b', null, 5))

    expect(nextOrder(index, null)).toBe(6)
    expect(nextOrder(index, 'a')).toBe(0)
  })

  it('reports a document that does not exist', () => {
    expect(() => docOrThrow(EMPTY_INDEX, 'ghost')).toThrow(/not found/)
  })

  it('retire un document et ses descendants', () => {
    const index = indexOf(doc('a'), doc('b', 'a'), doc('c'))

    const after = removeAll(index, ['a', 'b'])

    expect(Object.keys(after.docs)).toEqual(['c'])
  })

  describe('moving', () => {
    it('change de parent', () => {
      const index = indexOf(doc('a'), doc('b'), doc('feuille', 'a'))

      const after = moveDoc(index, 'feuille', 'b')

      expect(ids(childrenOf(after, 'a'))).toEqual([])
      expect(ids(childrenOf(after, 'b'))).toEqual(['feuille'])
    })

    it('reorders among siblings', () => {
      const index = indexOf(doc('a', null, 0), doc('b', null, 1), doc('c', null, 2))

      const after = moveDoc(index, 'c', null, 0)

      expect(ids(childrenOf(after, null))).toEqual(['c', 'a', 'b'])
    })

    it('puts it last when no position is requested', () => {
      const index = indexOf(doc('a', null, 0), doc('b', null, 1))

      expect(ids(childrenOf(moveDoc(index, 'a', null), null))).toEqual(['b', 'a'])
    })

    it('accepts an out-of-range position without complaining', () => {
      const index = indexOf(doc('a', null, 0), doc('b', null, 1))

      expect(ids(childrenOf(moveDoc(index, 'a', null, 99), null))).toEqual(['b', 'a'])
      expect(ids(childrenOf(moveDoc(index, 'b', null, -5), null))).toEqual(['b', 'a'])
    })

    it('refuses to move a page into its own subtree', () => {
      const index = indexOf(doc('racine'), doc('enfant', 'racine'), doc('petit', 'enfant'))

      // Without this guard, the whole branch would detach from the tree: it
      // would stay in the database, invisible, and unrecoverable from the interface.
      expect(() => moveDoc(index, 'racine', 'petit')).toThrow(/own subtree/)
      expect(() => moveDoc(index, 'racine', 'racine')).toThrow(/own subtree/)
    })

    it('refuses a parent that does not exist', () => {
      expect(() => moveDoc(indexOf(doc('a')), 'a', 'ghost')).toThrow(/not found/)
    })

    it('renumbers the sibling list when room runs out', () => {
      // We insert fifty times in a row at the same spot: the gap between
      // two positions ends up below the precision threshold, and the sibling list must
      // be reassigned rather than letting two pages sit on top of each other.
      let index = indexOf(doc('a', null, 0), doc('b', null, 1))
      for (let i = 0; i < 50; i++) {
        index = upsert(index, doc(`n${i}`, null, 0))
        index = moveDoc(index, `n${i}`, null, 1)
      }

      const ordered = childrenOf(index, null)
      const orders = ordered.map((d) => d.order)

      expect(new Set(orders).size).toBe(orders.length)
      expect(ordered[0]?.id).toBe('a')
      expect(ordered.at(-1)?.id).toBe('b')
    })
  })
})
