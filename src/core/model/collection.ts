/**
 * Databases — a table of rows with typed columns, shown as a table, a board or
 * a calendar.
 *
 * **A database is a document.** Its content is just another shape of the opaque
 * JSON the core already stores, so it inherits encryption, the index, search,
 * the page tree, export and import without a line of new storage code. The
 * alternative — a separate object store — would have duplicated every one of
 * those, and for no benefit a user could name.
 *
 * Everything here is a pure function over a value. Filtering, sorting and
 * grouping are decisions, not renderings, so they belong on this side of the
 * boundary where they can be tested in microseconds.
 */

import type { JsonValue } from './types'

export type PropertyType = 'text' | 'number' | 'select' | 'date' | 'checkbox' | 'url'

export type Property = {
  readonly id: string
  readonly name: string
  readonly type: PropertyType
  /** Allowed values for `select`. Empty for every other type. */
  readonly options: readonly string[]
}

export type Cell = string | number | boolean | null
export type Row = { readonly id: string; readonly cells: Readonly<Record<string, Cell>> }

export type FilterOperator = 'is' | 'isNot' | 'contains' | 'isEmpty' | 'isNotEmpty'
export type Filter = {
  readonly propertyId: string
  readonly operator: FilterOperator
  readonly value?: Cell
}

export type Sort = { readonly propertyId: string; readonly direction: 'asc' | 'desc' }

export type ViewKind = 'table' | 'board' | 'calendar'
export type View = {
  readonly id: string
  readonly name: string
  readonly kind: ViewKind
  readonly filters: readonly Filter[]
  readonly sorts: readonly Sort[]
  /** Which property splits a board into columns, or dates a calendar. */
  readonly groupBy?: string
}

export type CollectionContent = {
  readonly kind: 'collection'
  readonly properties: readonly Property[]
  readonly rows: readonly Row[]
  readonly views: readonly View[]
}

export function isCollection(content: JsonValue): content is CollectionContent & JsonValue {
  return (
    typeof content === 'object' &&
    content !== null &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === 'collection'
  )
}

/**
 * A database people can use immediately rather than one they must configure.
 *
 * An empty table with no columns is a blank stare; Name / Status / Due is the
 * shape most lists actually take, and every part of it is renameable.
 */
export function newCollection(newId: () => string): CollectionContent {
  const name: Property = { id: newId(), name: 'Name', type: 'text', options: [] }
  const status: Property = {
    id: newId(),
    name: 'Status',
    type: 'select',
    options: ['To do', 'Doing', 'Done'],
  }
  const due: Property = { id: newId(), name: 'Due', type: 'date', options: [] }

  return {
    kind: 'collection',
    properties: [name, status, due],
    rows: [],
    views: [
      { id: newId(), name: 'Table', kind: 'table', filters: [], sorts: [] },
      { id: newId(), name: 'Board', kind: 'board', filters: [], sorts: [], groupBy: status.id },
      { id: newId(), name: 'Calendar', kind: 'calendar', filters: [], sorts: [], groupBy: due.id },
    ],
  }
}

export function emptyRow(newId: () => string, properties: readonly Property[]): Row {
  return { id: newId(), cells: Object.fromEntries(properties.map((p) => [p.id, null])) }
}

// -------------------------------------------------------------- transforms

export function addRow(collection: CollectionContent, row: Row): CollectionContent {
  return { ...collection, rows: [...collection.rows, row] }
}

export function removeRow(collection: CollectionContent, rowId: string): CollectionContent {
  return { ...collection, rows: collection.rows.filter((row) => row.id !== rowId) }
}

export function setCell(
  collection: CollectionContent,
  rowId: string,
  propertyId: string,
  value: Cell,
): CollectionContent {
  return {
    ...collection,
    rows: collection.rows.map((row) =>
      row.id === rowId ? { ...row, cells: { ...row.cells, [propertyId]: value } } : row,
    ),
  }
}

export function addProperty(collection: CollectionContent, property: Property): CollectionContent {
  return { ...collection, properties: [...collection.properties, property] }
}

/**
 * Removing a column drops its values too.
 *
 * Keeping them would leave data nothing can read or delete — invisible weight
 * that reappears the day someone recreates a column with the same identifier.
 */
export function removeProperty(
  collection: CollectionContent,
  propertyId: string,
): CollectionContent {
  return {
    ...collection,
    properties: collection.properties.filter((property) => property.id !== propertyId),
    rows: collection.rows.map((row) => {
      const cells = { ...row.cells }
      delete cells[propertyId]
      return { ...row, cells }
    }),
    views: collection.views.map((view) => {
      // `groupBy` is dropped rather than set to `undefined`: with
      // `exactOptionalPropertyTypes` those are different types, and an absent
      // key is what "this view no longer groups" actually means.
      const { groupBy, ...rest } = view
      const next = {
        ...rest,
        filters: view.filters.filter((filter) => filter.propertyId !== propertyId),
        sorts: view.sorts.filter((sort) => sort.propertyId !== propertyId),
      }
      return groupBy === undefined || groupBy === propertyId ? next : { ...next, groupBy }
    }),
  }
}

export function updateView(collection: CollectionContent, view: View): CollectionContent {
  return {
    ...collection,
    views: collection.views.map((current) => (current.id === view.id ? view : current)),
  }
}

// ------------------------------------------------------------------ queries

const isBlank = (cell: Cell | undefined): boolean =>
  cell === null || cell === undefined || cell === ''

function matches(row: Row, filter: Filter): boolean {
  const cell = row.cells[filter.propertyId]

  switch (filter.operator) {
    case 'isEmpty':
      return isBlank(cell)
    case 'isNotEmpty':
      return !isBlank(cell)
    case 'is':
      return cell === filter.value
    case 'isNot':
      return cell !== filter.value
    case 'contains':
      return String(cell ?? '')
        .toLowerCase()
        .includes(String(filter.value ?? '').toLowerCase())
    default:
      // An unknown operator hides every row, which is visible immediately.
      // Letting them all through would look like a filter that silently does
      // nothing at all.
      return false
  }
}

/**
 * Compares two cells of the same column.
 *
 * Blanks always sort last, whichever direction is asked for. A column sorted
 * by due date should show the dated rows first in both directions; burying
 * them under the undated ones is never what someone meant.
 */
function compare(a: Cell | undefined, b: Cell | undefined, direction: 'asc' | 'desc'): number {
  if (isBlank(a) && isBlank(b)) return 0
  if (isBlank(a)) return 1
  if (isBlank(b)) return -1

  const sign = direction === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign
  if (typeof a === 'boolean' && typeof b === 'boolean') return (Number(a) - Number(b)) * sign
  return String(a).localeCompare(String(b), undefined, { numeric: true }) * sign
}

export function visibleRows(collection: CollectionContent, view: View): Row[] {
  const filtered = collection.rows.filter((row) =>
    view.filters.every((filter) => matches(row, filter)),
  )
  if (view.sorts.length === 0) return filtered

  return filtered.toSorted((a, b) => {
    for (const sort of view.sorts) {
      const result = compare(a.cells[sort.propertyId], b.cells[sort.propertyId], sort.direction)
      if (result !== 0) return result
    }
    return 0
  })
}

export type Group = { readonly key: string; readonly label: string; readonly rows: readonly Row[] }

/**
 * Splits rows into board columns.
 *
 * A `select` column produces one group per declared option **even when it is
 * empty**, because an empty "Done" column is exactly where you drag a card.
 * Groups that only exist when occupied make a board that reshapes itself as
 * you use it.
 */
export function groupRows(collection: CollectionContent, view: View): Group[] {
  const rows = visibleRows(collection, view)
  const property = collection.properties.find((candidate) => candidate.id === view.groupBy)
  if (!property) return [{ key: '', label: 'All', rows }]

  const groups = new Map<string, Row[]>()
  for (const option of property.options) groups.set(option, [])
  groups.set('', [])

  for (const row of rows) {
    const cell = row.cells[property.id]
    const key = isBlank(cell) ? '' : String(cell)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  return [...groups]
    .map(([key, grouped]) => ({ key, label: key === '' ? 'No value' : key, rows: grouped }))
    .filter((group) => group.key !== '' || group.rows.length > 0)
}
