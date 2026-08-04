import { useMemo, useState } from 'react'
import {
  addRow,
  emptyRow,
  groupRows,
  removeRow,
  setCell,
  updateView,
  visibleRows,
  type Cell,
  type CollectionContent,
  type Property,
  type Row,
  type View,
} from '../../core/model/collection'
import { newId } from '../../core/model/types'
import { Button, IconButton } from '../design/Button'
import { Icon } from '../design/Icon'

/**
 * A database, shown as a table, a board or a calendar.
 *
 * The three are views of one set of rows, not three features: switching does
 * not move anything, it re-reads the same data through a different lens. That
 * is why filtering, sorting and grouping live in the core as pure functions —
 * this file only decides what a group looks like on screen.
 *
 * Editing is direct. There is no row dialog, because a table where you type
 * into the cell is the reason people reach for a table in the first place.
 */
export function CollectionView({
  collection,
  onChange,
}: {
  collection: CollectionContent
  onChange: (next: CollectionContent) => void
}) {
  const [viewId, setViewId] = useState(collection.views[0]?.id ?? '')
  const view = collection.views.find((candidate) => candidate.id === viewId) ?? collection.views[0]

  if (!view) return null

  const edit = (rowId: string, propertyId: string, value: Cell) =>
    onChange(setCell(collection, rowId, propertyId, value))

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div role="tablist" aria-label="Views" className="flex items-center gap-0.5">
          {collection.views.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === view.id}
              onClick={() => setViewId(candidate.id)}
              className={[
                'rounded-sm px-2.5 py-1 text-xs transition-colors duration-(--nook-dur-fast) ease-nook',
                candidate.id === view.id
                  ? 'bg-hover font-medium text-ink'
                  : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {candidate.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <SortControl collection={collection} view={view} onChange={onChange} />
          <Button
            size="sm"
            onClick={() => onChange(addRow(collection, emptyRow(newId, collection.properties)))}
          >
            <Icon name="plus" className="size-3.5" />
            New row
          </Button>
        </div>
      </div>

      {view.kind === 'table' && (
        <TableView collection={collection} view={view} onEdit={edit} onChange={onChange} />
      )}
      {view.kind === 'board' && <BoardView collection={collection} view={view} onEdit={edit} />}
      {view.kind === 'calendar' && <CalendarView collection={collection} view={view} />}
    </section>
  )
}

function SortControl({
  collection,
  view,
  onChange,
}: {
  collection: CollectionContent
  view: View
  onChange: (next: CollectionContent) => void
}) {
  const current = view.sorts[0]

  return (
    <label className="flex items-center gap-1 text-xs text-ink-faint">
      Sort
      <select
        value={current ? `${current.propertyId}:${current.direction}` : ''}
        onChange={(event) => {
          const [propertyId, direction] = event.target.value.split(':')
          onChange(
            updateView(collection, {
              ...view,
              sorts:
                propertyId && direction
                  ? [{ propertyId, direction: direction as 'asc' | 'desc' }]
                  : [],
            }),
          )
        }}
        className="rounded-sm border border-line bg-surface px-1.5 py-1 text-xs text-ink outline-none"
      >
        <option value="">none</option>
        {collection.properties.flatMap((property) => [
          <option key={`${property.id}:asc`} value={`${property.id}:asc`}>
            {property.name} ↑
          </option>,
          <option key={`${property.id}:desc`} value={`${property.id}:desc`}>
            {property.name} ↓
          </option>,
        ])}
      </select>
    </label>
  )
}

function TableView({
  collection,
  view,
  onEdit,
  onChange,
}: {
  collection: CollectionContent
  view: View
  onEdit: (rowId: string, propertyId: string, value: Cell) => void
  onChange: (next: CollectionContent) => void
}) {
  const rows = visibleRows(collection, view)

  if (rows.length === 0) return <EmptyTable />

  return (
    // The table can be wider than the reading column; it scrolls inside its
    // own box rather than making the whole page scroll sideways.
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {collection.properties.map((property) => (
              <th
                key={property.id}
                scope="col"
                className="border-b border-line px-2 py-1.5 text-left text-xs font-medium text-ink-faint"
              >
                {property.name}
              </th>
            ))}
            <th className="border-b border-line px-2 py-1.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group">
              {collection.properties.map((property) => (
                <td key={property.id} className="border-b border-line p-0 align-middle">
                  <CellEditor
                    property={property}
                    value={row.cells[property.id] ?? null}
                    onChange={(value) => onEdit(row.id, property.id, value)}
                  />
                </td>
              ))}
              <td className="border-b border-line px-1 text-right">
                <span className="opacity-0 transition-opacity duration-(--nook-dur-fast) group-hover:opacity-100 group-focus-within:opacity-100">
                  <IconButton
                    label="Delete row"
                    size="sm"
                    onClick={() => onChange(removeRow(collection, row.id))}
                  >
                    <Icon name="trash" className="size-3.5" />
                  </IconButton>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoardView({
  collection,
  view,
  onEdit,
}: {
  collection: CollectionContent
  view: View
  onEdit: (rowId: string, propertyId: string, value: Cell) => void
}) {
  const groups = groupRows(collection, view)
  const titleProperty = collection.properties[0]

  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
      {groups.map((group) => (
        <div key={group.key} className="w-56 shrink-0">
          <h3 className="flex items-baseline justify-between px-1 pb-2 text-xs font-medium text-ink-faint">
            {group.label}
            <span data-numeric className="text-2xs">
              {group.rows.length}
            </span>
          </h3>
          <ul className="space-y-1.5">
            {group.rows.map((row) => (
              <li
                key={row.id}
                className="rounded-sm border border-line bg-raised p-2.5 text-sm shadow-menu"
              >
                {titleProperty ? (
                  <CellEditor
                    property={titleProperty}
                    value={row.cells[titleProperty.id] ?? null}
                    onChange={(value) => onEdit(row.id, titleProperty.id, value)}
                  />
                ) : null}
                <CardMeta collection={collection} view={view} row={row} />
              </li>
            ))}
            {group.rows.length === 0 && (
              <li className="rounded-sm border border-dashed border-line px-2.5 py-4 text-center text-xs text-ink-faint">
                Nothing here
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The properties a card shows beyond its title: everything but the grouping one. */
function CardMeta({
  collection,
  view,
  row,
}: {
  collection: CollectionContent
  view: View
  row: Row
}) {
  const extras = collection.properties
    .slice(1)
    .filter((property) => property.id !== view.groupBy)
    .map((property) => ({ property, value: row.cells[property.id] }))
    .filter((entry) => entry.value !== null && entry.value !== undefined && entry.value !== '')

  if (extras.length === 0) return null

  return (
    <dl className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-faint">
      {extras.map(({ property, value }) => (
        <div key={property.id} className="flex gap-1">
          <dt className="sr-only">{property.name}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A month, with the rows that fall on each day.
 *
 * The month shown is the one holding the earliest dated row, not today. A
 * calendar that opens on an empty current month while every entry sits in
 * March looks broken.
 */
function CalendarView({ collection, view }: { collection: CollectionContent; view: View }) {
  const rows = visibleRows(collection, view)
  const dateProperty =
    collection.properties.find((property) => property.id === view.groupBy) ??
    collection.properties.find((property) => property.type === 'date')
  const titleProperty = collection.properties[0]

  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>()
    if (!dateProperty) return map
    for (const row of rows) {
      const value = row.cells[dateProperty.id]
      if (typeof value !== 'string' || value === '') continue
      map.set(value.slice(0, 10), [...(map.get(value.slice(0, 10)) ?? []), row])
    }
    return map
  }, [rows, dateProperty])

  if (!dateProperty) {
    return <p className="mt-6 text-sm text-ink-faint">This view needs a date column.</p>
  }

  const first = [...byDay.keys()].toSorted()[0]
  const anchor = first ? new Date(`${first}T00:00:00`) : new Date()
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // Monday-first: `getDay()` counts from Sunday, so Sunday becomes the seventh.
  const offset = (new Date(year, month, 1).getDay() + 6) % 7

  return (
    <div className="mt-3">
      <h3 className="pb-2 text-xs font-medium text-ink-faint">
        {/* Formatted in English rather than the browser's locale: the weekday
            headers below are English, and one calendar showing "août 2026"
            above "Mon Tue Wed" reads as unfinished. The dates themselves stay
            as the user stored them. */}
        {anchor.toLocaleString('en', { month: 'long', year: 'numeric' })}
      </h3>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-sm border border-line bg-line">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
          <div key={label} className="bg-sunken px-2 py-1 text-2xs text-ink-faint">
            {label}
          </div>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <div key={`pad-${index}`} className="min-h-20 bg-surface" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const entries = byDay.get(key) ?? []
          return (
            <div key={key} className="min-h-20 bg-surface p-1.5">
              <span data-numeric className="text-2xs text-ink-faint">
                {day}
              </span>
              <ul className="mt-1 space-y-1">
                {entries.map((row) => (
                  <li
                    key={row.id}
                    className="truncate rounded-xs bg-accent-soft px-1.5 py-0.5 text-2xs text-ink"
                  >
                    {titleProperty ? String(row.cells[titleProperty.id] ?? '—') : '—'}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One cell, edited in place.
 *
 * The input type follows the column type, so a date column gets a date picker
 * and a checkbox gets a checkbox — the browser's own controls, which already
 * work with a keyboard, a screen reader and a touch screen.
 */
function CellEditor({
  property,
  value,
  onChange,
}: {
  property: Property
  value: Cell
  onChange: (value: Cell) => void
}) {
  const shared =
    'w-full min-w-0 border-0 bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint'

  if (property.type === 'checkbox') {
    return (
      <span className="flex items-center px-2 py-1.5">
        <input
          type="checkbox"
          checked={value === true}
          aria-label={property.name}
          onChange={(event) => onChange(event.target.checked)}
          className="size-3.5 accent-[var(--nook-accent)]"
        />
      </span>
    )
  }

  if (property.type === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        aria-label={property.name}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className={shared}
      >
        <option value="">—</option>
        {property.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }

  const type = property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'

  return (
    <input
      type={type}
      value={value === null || value === undefined ? '' : String(value)}
      aria-label={property.name}
      placeholder="—"
      onChange={(event) => {
        const raw = event.target.value
        if (raw === '') return onChange(null)
        onChange(property.type === 'number' ? Number(raw) : raw)
      }}
      className={shared}
    />
  )
}

function EmptyTable() {
  return (
    <p className="mt-6 text-center text-sm text-ink-faint">No rows yet — add one to get started.</p>
  )
}
