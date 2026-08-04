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

/** A complete document, content included. Loaded on open, one at a time. */
export type Doc = DocSummary & {
  readonly content: JsonValue
}

/**
 * The vault's index: a single encrypted record describing everything except
 * the content of the documents.
 */
export type VaultIndex = {
  readonly schema: 1
  readonly docs: Readonly<Record<DocId, DocSummary>>
}

export const EMPTY_INDEX: VaultIndex = { schema: 1, docs: {} }

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
