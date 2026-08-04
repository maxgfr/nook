/**
 * The daily note.
 *
 * Its title is the date, and the date is the whole identity: opening today's
 * note twice must land on the same page rather than pile up duplicates. The
 * format is therefore fixed and sortable (`2026-08-04`), never localised —
 * a title that changes with the reader's locale would split one day's note
 * into several.
 */

import type { DocSummary, VaultIndex } from './types'
import { normalize } from './facets'

export function dailyNoteTitle(date: Date = new Date()): string {
  // Local date parts, not `toISOString()`: at 01:00 in Paris the UTC day is
  // still yesterday, and the note would open under the wrong date.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function findDailyNote(index: VaultIndex, date?: Date): DocSummary | undefined {
  const title = normalize(dailyNoteTitle(date))
  return Object.values(index.docs).find((doc) => normalize(doc.title) === title)
}
