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

describe('arbre des pages', () => {
  it('range les frères par ordre croissant', () => {
    const index = indexOf(doc('c', null, 2), doc('a', null, 0), doc('b', null, 1))

    expect(ids(childrenOf(index, null))).toEqual(['a', 'b', 'c'])
  })

  it('départage deux frères de même ordre par date de création', () => {
    const index = indexOf(
      { ...doc('récent', null, 0), createdAt: '2026-06-01T00:00:00.000Z' },
      { ...doc('ancien', null, 0), createdAt: '2026-01-01T00:00:00.000Z' },
    )

    expect(ids(childrenOf(index, null))).toEqual(['ancien', 'récent'])
  })

  it('remonte la chaîne des ancêtres, du plus lointain au parent direct', () => {
    const index = indexOf(doc('racine'), doc('milieu', 'racine'), doc('feuille', 'milieu'))

    expect(ids(ancestorsOf(index, 'feuille'))).toEqual(['racine', 'milieu'])
    expect(ancestorsOf(index, 'racine')).toEqual([])
  })

  it('ne boucle pas sur un arbre corrompu', () => {
    // Un cycle ne devrait jamais exister, mais un index abîmé ne doit pas
    // figer l'application.
    const index = indexOf(doc('a', 'b'), doc('b', 'a'))

    expect(() => ancestorsOf(index, 'a')).not.toThrow()
    expect(ids(ancestorsOf(index, 'a')).length).toBeLessThanOrEqual(2)
  })

  it('collecte toute la descendance en profondeur', () => {
    const index = indexOf(
      doc('racine'),
      doc('enfant1', 'racine'),
      doc('enfant2', 'racine', 1),
      doc('petit', 'enfant1'),
    )

    expect(descendantIdsOf(index, 'racine').toSorted()).toEqual(['enfant1', 'enfant2', 'petit'])
    expect(descendantIdsOf(index, 'petit')).toEqual([])
  })

  it('place un nouveau document après ses frères', () => {
    const index = indexOf(doc('a', null, 0), doc('b', null, 5))

    expect(nextOrder(index, null)).toBe(6)
    expect(nextOrder(index, 'a')).toBe(0)
  })

  it('signale un document introuvable', () => {
    expect(() => docOrThrow(EMPTY_INDEX, 'fantôme')).toThrow(/introuvable/)
  })

  it('retire un document et ses descendants', () => {
    const index = indexOf(doc('a'), doc('b', 'a'), doc('c'))

    const after = removeAll(index, ['a', 'b'])

    expect(Object.keys(after.docs)).toEqual(['c'])
  })

  describe('déplacement', () => {
    it('change de parent', () => {
      const index = indexOf(doc('a'), doc('b'), doc('feuille', 'a'))

      const after = moveDoc(index, 'feuille', 'b')

      expect(ids(childrenOf(after, 'a'))).toEqual([])
      expect(ids(childrenOf(after, 'b'))).toEqual(['feuille'])
    })

    it('réordonne entre frères', () => {
      const index = indexOf(doc('a', null, 0), doc('b', null, 1), doc('c', null, 2))

      const after = moveDoc(index, 'c', null, 0)

      expect(ids(childrenOf(after, null))).toEqual(['c', 'a', 'b'])
    })

    it('met à la fin quand aucune position n’est demandée', () => {
      const index = indexOf(doc('a', null, 0), doc('b', null, 1))

      expect(ids(childrenOf(moveDoc(index, 'a', null), null))).toEqual(['b', 'a'])
    })

    it('accepte une position hors bornes sans se plaindre', () => {
      const index = indexOf(doc('a', null, 0), doc('b', null, 1))

      expect(ids(childrenOf(moveDoc(index, 'a', null, 99), null))).toEqual(['b', 'a'])
      expect(ids(childrenOf(moveDoc(index, 'b', null, -5), null))).toEqual(['b', 'a'])
    })

    it('refuse de déplacer une page dans sa propre descendance', () => {
      const index = indexOf(doc('racine'), doc('enfant', 'racine'), doc('petit', 'enfant'))

      // Sans ce garde-fou, toute la branche se détacherait de l'arbre : elle
      // resterait en base, invisible, et irrécupérable depuis l'interface.
      expect(() => moveDoc(index, 'racine', 'petit')).toThrow(/sous-arborescence/)
      expect(() => moveDoc(index, 'racine', 'racine')).toThrow(/sous-arborescence/)
    })

    it('refuse un parent inexistant', () => {
      expect(() => moveDoc(indexOf(doc('a')), 'a', 'fantôme')).toThrow(/introuvable/)
    })

    it('renumérote la fratrie quand la place vient à manquer', () => {
      // On insère cinquante fois de suite au même endroit : l'écart entre
      // deux positions finit sous le seuil de précision, et la fratrie doit
      // être réattribuée plutôt que de voir deux pages se superposer.
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
