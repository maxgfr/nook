import { describe, expect, it } from 'vitest'
import {
  addProperty,
  addRow,
  emptyRow,
  groupRows,
  isCollection,
  newCollection,
  removeProperty,
  removeRow,
  setCell,
  visibleRows,
  type CollectionContent,
  type View,
} from './collection'

let counter = 0
const nextId = () => `id-${++counter}`

function fixture(): { collection: CollectionContent; name: string; status: string; due: string } {
  const collection = newCollection(nextId)
  const [name, status, due] = collection.properties
  return {
    collection,
    name: name?.id as string,
    status: status?.id as string,
    due: due?.id as string,
  }
}

const table = (over: Partial<View> = {}): View => ({
  id: 'view',
  name: 'Table',
  kind: 'table',
  filters: [],
  sorts: [],
  ...over,
})

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id)

describe('a new database', () => {
  it('arrives usable rather than blank', () => {
    const collection = newCollection(nextId)

    expect(collection.properties.map((p) => p.name)).toEqual(['Name', 'Status', 'Due'])
    expect(collection.views.map((v) => v.kind)).toEqual(['table', 'board', 'calendar'])
    expect(collection.rows).toEqual([])
  })

  it('is recognisable from opaque content', () => {
    expect(isCollection(newCollection(nextId) as never)).toBe(true)
    expect(isCollection([{ type: 'paragraph' }])).toBe(false)
    expect(isCollection(null)).toBe(false)
    expect(isCollection('collection')).toBe(false)
  })
})

describe('rows and columns', () => {
  it('adds, edits and removes a row', () => {
    const { collection, name } = fixture()
    const row = emptyRow(nextId, collection.properties)

    let next = addRow(collection, row)
    next = setCell(next, row.id, name, 'Buy bread')
    expect(next.rows[0]?.cells[name]).toBe('Buy bread')

    expect(removeRow(next, row.id).rows).toEqual([])
  })

  it('leaves other rows untouched when editing one', () => {
    const { collection, name } = fixture()
    const first = emptyRow(nextId, collection.properties)
    const second = emptyRow(nextId, collection.properties)

    const next = setCell(addRow(addRow(collection, first), second), first.id, name, 'edited')

    expect(next.rows[1]?.cells[name]).toBeNull()
  })

  it('drops a column’s values with the column', () => {
    const { collection, name, status } = fixture()
    const row = emptyRow(nextId, collection.properties)
    const filled = setCell(addRow(collection, row), row.id, status, 'Doing')

    const next = removeProperty(filled, status)

    // Values left behind would be unreachable weight that reappears the day a
    // column reuses the identifier.
    expect(Object.keys(next.rows[0]?.cells ?? {})).not.toContain(status)
    expect(next.rows[0]?.cells[name]).toBeNull()
    expect(next.views.find((v) => v.kind === 'board')?.groupBy).toBeUndefined()
  })

  it('adds a column without disturbing existing rows', () => {
    const { collection } = fixture()
    const row = emptyRow(nextId, collection.properties)
    const extra = { id: nextId(), name: 'Owner', type: 'text' as const, options: [] }

    const next = addProperty(addRow(collection, row), extra)

    expect(next.properties.at(-1)?.name).toBe('Owner')
    expect(next.rows[0]?.cells[extra.id]).toBeUndefined()
  })
})

describe('filtering', () => {
  function seeded() {
    const { collection, name, status } = fixture()
    let next = collection
    for (const [label, state] of [
      ['Alpha', 'Done'],
      ['Beta', 'Doing'],
      ['Gamma', null],
    ] as const) {
      const row = { id: label, cells: { [name]: label, [status]: state } }
      next = addRow(next, row)
    }
    return { collection: next, name, status }
  }

  it('keeps everything when there is no filter', () => {
    const { collection } = seeded()
    expect(visibleRows(collection, table())).toHaveLength(3)
  })

  it('matches an exact value', () => {
    const { collection, status } = seeded()
    const view = table({ filters: [{ propertyId: status, operator: 'is', value: 'Done' }] })

    expect(ids(visibleRows(collection, view))).toEqual(['Alpha'])
  })

  it('matches a substring, ignoring case', () => {
    const { collection, name } = seeded()
    const view = table({ filters: [{ propertyId: name, operator: 'contains', value: 'ET' }] })

    expect(ids(visibleRows(collection, view))).toEqual(['Beta'])
  })

  it('finds blanks and non-blanks', () => {
    const { collection, status } = seeded()

    expect(
      ids(
        visibleRows(collection, table({ filters: [{ propertyId: status, operator: 'isEmpty' }] })),
      ),
    ).toEqual(['Gamma'])
    expect(
      ids(
        visibleRows(
          collection,
          table({ filters: [{ propertyId: status, operator: 'isNotEmpty' }] }),
        ),
      ),
    ).toEqual(['Alpha', 'Beta'])
  })

  it('combines filters with AND', () => {
    const { collection, name, status } = seeded()
    const view = table({
      filters: [
        { propertyId: status, operator: 'isNotEmpty' },
        { propertyId: name, operator: 'contains', value: 'a' },
      ],
    })

    expect(ids(visibleRows(collection, view))).toEqual(['Alpha', 'Beta'])
  })

  it('hides everything on an operator it does not know', () => {
    const { collection, status } = seeded()
    const view = table({ filters: [{ propertyId: status, operator: 'wat' as never }] })

    // Visible immediately, unlike a filter that silently does nothing.
    expect(visibleRows(collection, view)).toEqual([])
  })
})

describe('sorting', () => {
  function seeded() {
    const { collection, name, due } = fixture()
    let next = collection
    for (const [label, date] of [
      ['b', '2026-03-01'],
      ['a', '2026-01-01'],
      ['blank', null],
      ['c', '2026-02-01'],
    ] as const) {
      next = addRow(next, { id: label, cells: { [name]: label, [due]: date } })
    }
    return { collection: next, name, due }
  }

  it('sorts ascending and descending', () => {
    const { collection, due } = seeded()

    expect(
      ids(visibleRows(collection, table({ sorts: [{ propertyId: due, direction: 'asc' }] }))),
    ).toEqual(['a', 'c', 'b', 'blank'])
    expect(
      ids(visibleRows(collection, table({ sorts: [{ propertyId: due, direction: 'desc' }] }))),
    ).toEqual(['b', 'c', 'a', 'blank'])
  })

  it('keeps blanks last in both directions', () => {
    const { collection, due } = seeded()

    // Burying the dated rows under the undated ones is never what was meant.
    for (const direction of ['asc', 'desc'] as const) {
      expect(
        ids(visibleRows(collection, table({ sorts: [{ propertyId: due, direction }] }))).at(-1),
      ).toBe('blank')
    }
  })

  it('falls through to the next sort on a tie', () => {
    const { collection, name, due } = fixture()
    let next = addRow(collection, { id: 'x', cells: { [name]: 'z', [due]: '2026-01-01' } })
    next = addRow(next, { id: 'y', cells: { [name]: 'a', [due]: '2026-01-01' } })

    const view = table({
      sorts: [
        { propertyId: due, direction: 'asc' },
        { propertyId: name, direction: 'asc' },
      ],
    })

    expect(ids(visibleRows(next, view))).toEqual(['y', 'x'])
  })

  it('orders numbers as numbers, not as text', () => {
    const { collection } = fixture()
    const amount = { id: nextId(), name: 'Amount', type: 'number' as const, options: [] }
    let next = addProperty(collection, amount)
    for (const value of [2, 10, 1]) {
      next = addRow(next, { id: `n${value}`, cells: { [amount.id]: value } })
    }

    const view = table({ sorts: [{ propertyId: amount.id, direction: 'asc' }] })
    expect(ids(visibleRows(next, view))).toEqual(['n1', 'n2', 'n10'])
  })
})

describe('grouping into a board', () => {
  function seeded() {
    const { collection, name, status } = fixture()
    let next = collection
    for (const [label, state] of [
      ['a', 'To do'],
      ['b', 'Doing'],
      ['c', 'To do'],
      ['d', null],
    ] as const) {
      next = addRow(next, { id: label, cells: { [name]: label, [status]: state } })
    }
    return { collection: next, status }
  }

  it('shows every declared option, even an empty one', () => {
    const { collection, status } = seeded()

    const groups = groupRows(collection, table({ kind: 'board', groupBy: status }))

    // "Done" holds nothing yet and must still be there: it is where you drop
    // a card.
    expect(groups.map((g) => g.label)).toEqual(['To do', 'Doing', 'Done', 'No value'])
    expect(ids(groups[0]?.rows ?? [])).toEqual(['a', 'c'])
  })

  it('hides the blank column when nothing is unset', () => {
    const { collection, status } = seeded()
    const filled = setCell(collection, 'd', status, 'Done')

    const groups = groupRows(filled, table({ kind: 'board', groupBy: status }))

    expect(groups.map((g) => g.label)).toEqual(['To do', 'Doing', 'Done'])
  })

  it('falls back to a single group without a grouping column', () => {
    const { collection } = seeded()

    expect(groupRows(collection, table({ kind: 'board' })).map((g) => g.label)).toEqual(['All'])
  })

  it('applies the view’s filters before grouping', () => {
    const { collection, status } = seeded()
    const view = table({
      kind: 'board',
      groupBy: status,
      filters: [{ propertyId: status, operator: 'is', value: 'To do' }],
    })

    const groups = groupRows(collection, view)
    expect(groups.find((g) => g.label === 'Doing')?.rows).toEqual([])
    expect(ids(groups.find((g) => g.label === 'To do')?.rows ?? [])).toEqual(['a', 'c'])
  })
})
