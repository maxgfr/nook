/**
 * Search, backlinks and tags — everything that reads from the index, never
 * touching the encrypted content of a document.
 *
 * The ranking follows one idea: what people look for is almost always a page
 * whose name they roughly remember. A word found in the title therefore weighs
 * far more than a word found in the body, and a title that starts with the
 * query comes before a title that merely contains it.
 *
 * A document whose body holds only some of the requested words is dropped
 * rather than ranked last: a two-word search that returns the whole notebook
 * helps nobody.
 */

import { normalize, tokenize } from '../model/facets'
import type { DocId, DocSummary, VaultIndex } from '../model/types'

export type SearchHit = {
  readonly doc: DocSummary
  readonly score: number
  /** Why this result is here, so the interface can show it. */
  readonly matched: 'title' | 'body' | 'tag'
}

export function search(index: VaultIndex, query: string, limit = 20): SearchHit[] {
  const trimmed = query.trim()
  if (trimmed === '') return []

  const needle = normalize(trimmed)
  const tokens = tokenize(trimmed)
  const hits: SearchHit[] = []

  for (const doc of Object.values(index.docs)) {
    const facets = index.facets[doc.id]
    const title = normalize(doc.title)

    let score = 0
    let matched: SearchHit['matched'] = 'body'

    if (title !== '' && title === needle) score = 1000
    else if (title !== '' && title.startsWith(needle)) score = 500
    else if (title !== '' && title.includes(needle)) score = 300

    if (score > 0) {
      matched = 'title'
    } else if (facets && tokens.length > 0) {
      if (facets.tags.some((tag) => tag.startsWith(needle))) {
        score = 200
        matched = 'tag'
      } else if (tokens.every((token) => facets.terms.some((term) => term.startsWith(token)))) {
        // Every requested word is present: the score then favours a short
        // title, a short title being more likely to be the subject itself.
        score = 100 - Math.min(50, title.length)
        matched = 'body'
      }
    }

    if (score > 0) hits.push({ doc, score, matched })
  }

  return hits
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        // At equal relevance, the shorter title is nearer to what was typed:
        // "Product meeting" before "Product meeting notes".
        a.doc.title.length - b.doc.title.length ||
        b.doc.updatedAt.localeCompare(a.doc.updatedAt),
    )
    .slice(0, limit)
}

/**
 * The pages pointing at this one.
 *
 * Links resolve by title, as in any notebook where you write
 * `[[Product meeting]]` without knowing which identifier hides behind it. Two
 * pages sharing a title will therefore receive the same backlinks: that is the
 * expected behaviour of a link written by hand.
 */
export function backlinksOf(index: VaultIndex, id: DocId): DocSummary[] {
  const target = index.docs[id]
  if (!target || target.title.trim() === '') return []

  const title = normalize(target.title)
  return Object.values(index.docs)
    .filter((doc) => doc.id !== id && index.facets[doc.id]?.links.includes(title))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Targets of a page's `[[links]]` that match no existing page. */
export function brokenLinksOf(index: VaultIndex, id: DocId): string[] {
  const titles = new Set(
    Object.values(index.docs)
      .map((doc) => normalize(doc.title))
      .filter(Boolean),
  )
  return (index.facets[id]?.links ?? []).filter((link) => !titles.has(link))
}

/** Resolves a hand-written link target to an existing page. */
export function resolveLink(index: VaultIndex, target: string): DocSummary | undefined {
  const needle = normalize(target.trim())
  if (needle === '') return undefined
  return Object.values(index.docs).find((doc) => normalize(doc.title) === needle)
}

export function allTags(index: VaultIndex): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const facets of Object.values(index.facets)) {
    for (const tag of facets.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function docsWithTag(index: VaultIndex, tag: string): DocSummary[] {
  const needle = normalize(tag)
  return Object.values(index.docs)
    .filter((doc) => index.facets[doc.id]?.tags.includes(needle))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
