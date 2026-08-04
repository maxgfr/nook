/**
 * Nook's vocabulary.
 *
 * One decision carries all the rest: **the core does not know the format of a
 * document's content**. It stores it, encrypts it, extracts text from it for
 * search, but does not know what a level-2 heading or a checkbox is. Content
 * is opaque JSON.
 *
 * The benefit is direct: changing editor — or supporting two — does not touch
 * a line of storage, encryption or search.
 */

import type { DocFacets } from './facets'

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type DocId = string

/**
 * What the index keeps in memory for each document: enough to fill the
 * sidebar, the palette and the breadcrumbs without decrypting a single
 * piece of content.
 */
export type DocSummary = {
  readonly id: DocId
  readonly parentId: DocId | null
  readonly title: string
  readonly icon: string | null
  readonly createdAt: string
  readonly updatedAt: string
  /** Position among its siblings. See `model/tree.ts` for the mechanics. */
  readonly order: number
}

/**
 * A past state of a document, kept so a bad edit is not final.
 *
 * Snapshots live inside the document's own encrypted record: they are as
 * secret as the text they hold, and they travel with an export without any
 * extra plumbing.
 */
export type Snapshot = { readonly at: string; readonly content: JsonValue }

/** A complete document, content included. Loaded on open, one at a time. */
export type Doc = DocSummary & {
  readonly content: JsonValue
  /** Most recent first. Bounded — see `HISTORY_LIMIT`. */
  readonly history?: readonly Snapshot[]
}

/**
 * How many past states a document keeps.
 *
 * Bounded on purpose: unlimited history would grow the record that must be
 * decrypted every time the page opens, so old states would slow down the thing
 * they exist to protect.
 */
export const HISTORY_LIMIT = 20

/**
 * How long before an edit earns its own snapshot.
 *
 * Without this, autosave would file one every few seconds and the twenty slots
 * would all hold the same afternoon. With it, they span days.
 */
export const HISTORY_INTERVAL_MS = 5 * 60_000

/**
 * Decides what history a save should leave behind.
 *
 * Pure, so the coalescing rule is testable without a database or a clock.
 */
export function nextHistory(
  previous: readonly Snapshot[] | undefined,
  supersededContent: JsonValue,
  now: Date,
): Snapshot[] {
  const history = previous ?? []
  const last = history[0]
  const recent =
    last !== undefined && now.getTime() - new Date(last.at).getTime() < HISTORY_INTERVAL_MS

  if (recent) return [...history]
  return [{ at: now.toISOString(), content: supersededContent }, ...history].slice(0, HISTORY_LIMIT)
}

/**
 * The vault's index: a single encrypted record describing everything except
 * the content of the documents.
 *
 * Schema 2 added `facets`, so search and backlinks can answer without opening
 * any document; schema 3 added canvas positions. Older vaults are upgraded on
 * first open — see `Vault.open`.
 */
export type Point = { readonly x: number; readonly y: number }

export type VaultIndex = {
  readonly schema: 3
  readonly docs: Readonly<Record<DocId, DocSummary>>
  readonly facets: Readonly<Record<DocId, DocFacets>>
  /**
   * Where a page sits on the canvas, once someone has moved it.
   *
   * Absent means "wherever the layout puts it". Storing only what was moved
   * keeps the canvas useful from the first visit, with no placement step, and
   * keeps the index small for people who never open it.
   */
  readonly positions: Readonly<Record<DocId, Point>>
}

export const INDEX_SCHEMA = 3

export const EMPTY_INDEX: VaultIndex = {
  schema: INDEX_SCHEMA,
  docs: {},
  facets: {},
  positions: {},
}

export function newId(): DocId {
  return crypto.randomUUID()
}

/** Title shown for a document the user has not named yet. */
export const UNTITLED = 'Untitled'

/**
 * Extracts every readable string from a content tree, whatever its shape.
 *
 * Deliberately structural rather than semantic: we harvest every string in
 * the JSON tree without knowing anything about the editor's schema. That is
 * what keeps search working the day the content format changes.
 */
export function extractText(content: JsonValue): string {
  const parts: string[] = []
  const visit = (node: JsonValue): void => {
    if (typeof node === 'string') {
      parts.push(node)
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child)
    } else if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node)) visit(child)
    }
  }
  visit(content)
  return parts.join(' ')
}
