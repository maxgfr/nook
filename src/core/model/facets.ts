/**
 * What we derive from a document so it can be found and linked.
 *
 * These "facets" are recomputed on every save and kept in the encrypted index,
 * next to the tree. That is what lets search, backlinks and tags work **without
 * decrypting a single document**: opening the command palette must not cost the
 * decryption of the whole notebook.
 *
 * Only the distinct tokens of the body are kept, never the text itself. That is
 * enough to answer "which note mentions X", and it avoids copying all the
 * content into a record we load at startup.
 */

import { extractText, type JsonValue } from './types'

export type DocFacets = {
  /** Targets of `[[links]]`, normalised. */
  readonly links: readonly string[]
  /** `#tags` found, normalised, without the hash. */
  readonly tags: readonly string[]
  /** Distinct tokens from the title and the body. */
  readonly terms: readonly string[]
}

export const EMPTY_FACETS: DocFacets = { links: [], tags: [], terms: [] }

/**
 * Puts "Réunion Été" and "reunion ete" on the same footing.
 *
 * Without folding accents away, searching for "evenement" would never find
 * "événement" — which, in French, makes search close to unusable. The notes may
 * be written in any language even though the interface is English.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Splits into words, ignoring punctuation and single letters. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1)
}

const WIKILINK = /\[\[([^\][\n]+)\]\]/g
// The hash has to open a word: "C#" and "n°#3" are not tags, and neither is a
// colour like `#a8502c`.
const TAG = /(?:^|[\s(])#([\p{L}][\p{L}\p{N}_-]*)/gu

/**
 * A CSS colour opens with a letter often enough (`#a8502c`, `#eee`) that the
 * tag rule alone would swallow it. Hex colours have exactly 3, 4, 6 or 8 hex
 * digits, so the shape is recognisable without guessing.
 */
const HEX_COLOUR = /^[\da-f]{3}$|^[\da-f]{4}$|^[\da-f]{6}$|^[\da-f]{8}$/i

export function extractLinks(text: string): string[] {
  return unique([...text.matchAll(WIKILINK)].map((match) => normalize((match[1] as string).trim())))
}

export function extractTags(text: string): string[] {
  return unique(
    [...text.matchAll(TAG)]
      .map((match) => normalize(match[1] as string))
      .filter((tag) => !HEX_COLOUR.test(tag)),
  )
}

export function buildFacets(title: string, content: JsonValue): DocFacets {
  const text = `${title}\n${extractText(content)}`
  return {
    links: extractLinks(text),
    tags: extractTags(text),
    terms: unique(tokenize(text)),
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
