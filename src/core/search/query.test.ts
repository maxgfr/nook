import { describe, expect, it } from 'vitest'
import { buildFacets, extractLinks, extractTags, normalize, tokenize } from '../model/facets'
import { allTags, backlinksOf, brokenLinksOf, docsWithTag, resolveLink, search } from './query'
import { EMPTY_INDEX, type DocId, type VaultIndex } from '../model/types'

function withDoc(index: VaultIndex, id: DocId, title: string, body: string): VaultIndex {
  const content = [{ type: 'paragraph', content: [{ text: body }] }]
  return {
    ...index,
    docs: {
      ...index.docs,
      [id]: {
        id,
        parentId: null,
        title,
        icon: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: `2026-01-0${Object.keys(index.docs).length + 1}T00:00:00.000Z`,
        order: 0,
      },
    },
    facets: { ...index.facets, [id]: buildFacets(title, content) },
  }
}

const ids = (docs: { id: DocId }[]) => docs.map((d) => d.id)

/*
 * The French below is the subject, not prose that escaped a translation.
 *
 * The interface is in English and the notes are in whatever language they are
 * written in, which is the whole reason `normalize` exists: without folding
 * accents away, searching for "evenement" would never find "événement". A test
 * for that cannot be written in a language that has no accents to fold, so
 * these strings stay exactly as they are.
 */
describe('normalisation', () => {
  it('folds case and accents together', () => {
    expect(normalize('Réunion Été')).toBe('reunion ete')
    expect(normalize('Ça Va')).toBe('ca va')
  })

  it('splits on punctuation and drops single letters', () => {
    expect(tokenize("L'ordre du jour, v2 !")).toEqual(['ordre', 'du', 'jour', 'v2'])
  })
})

describe('extraction', () => {
  it('finds wikilinks', () => {
    expect(extractLinks('see [[Product meeting]] and [[Backlog]]')).toEqual([
      'product meeting',
      'backlog',
    ])
  })

  it('ignores an unterminated wikilink', () => {
    expect(extractLinks('a [[broken link and [[Real]]')).toEqual(['real'])
  })

  it('finds tags', () => {
    expect(extractTags('#urgent and (#project done')).toEqual(['urgent', 'project'])
  })

  it('does not mistake a colour or a suffix for a tag', () => {
    // `#a8502c` opens with a digit, and `C#` does not open a word at all.
    expect(extractTags('background #a8502c written in C# today')).toEqual([])
  })

  it('collects the title as well as the body', () => {
    const facets = buildFacets('Weekly #review', [{ text: 'see [[Backlog]]' }])

    expect(facets.tags).toEqual(['review'])
    expect(facets.links).toEqual(['backlog'])
    expect(facets.terms).toContain('weekly')
  })
})

describe('search', () => {
  const index = [
    ['a', 'Product meeting', 'we discussed the quote and the deadline'],
    ['b', 'Product meeting notes', 'nothing to report'],
    ['c', 'Groceries', 'buy bread and coffee'],
    ['d', 'Réunion été', 'canicule'],
  ].reduce(
    (acc, [id, title, body]) => withDoc(acc, id as DocId, title as string, body as string),
    EMPTY_INDEX,
  )

  it('returns nothing for an empty query', () => {
    expect(search(index, '   ')).toEqual([])
  })

  it('puts an exact title first', () => {
    expect(search(index, 'Product meeting')[0]?.doc.id).toBe('a')
  })

  it('prefers a title over a body match', () => {
    const hits = search(index, 'product')

    expect(ids(hits.map((h) => h.doc))).toEqual(['a', 'b'])
    expect(hits[0]?.matched).toBe('title')
  })

  it('finds a page by its body', () => {
    const hits = search(index, 'coffee')

    expect(hits.map((h) => h.doc.id)).toEqual(['c'])
    expect(hits[0]?.matched).toBe('body')
  })

  it('requires every word of the query', () => {
    // "bread" alone matches, but not together with a word that is nowhere.
    expect(search(index, 'bread')).toHaveLength(1)
    expect(search(index, 'bread helicopter')).toEqual([])
  })

  it('ignores accents on both sides', () => {
    expect(search(index, 'reunion ete').map((h) => h.doc.id)).toEqual(['d'])
    expect(search(index, 'CANICULE').map((h) => h.doc.id)).toEqual(['d'])
  })

  it('matches on a prefix of a word', () => {
    expect(search(index, 'canic').map((h) => h.doc.id)).toEqual(['d'])
  })

  it('honours the limit', () => {
    expect(search(index, 'product', 1)).toHaveLength(1)
  })
})

describe('links', () => {
  const index = [
    ['target', 'Product meeting', 'the agenda'],
    ['a', 'Monday', 'prepare [[Product meeting]]'],
    ['b', 'Tuesday', 'follow up on [[product MEETING]] and [[Nowhere]]'],
    ['c', 'Wednesday', 'nothing linked'],
  ].reduce(
    (acc, [id, title, body]) => withDoc(acc, id as DocId, title as string, body as string),
    EMPTY_INDEX,
  )

  it('lists the pages pointing here, whatever their case or accents', () => {
    expect(ids(backlinksOf(index, 'target')).toSorted()).toEqual(['a', 'b'])
  })

  it('does not count a page as its own backlink', () => {
    expect(backlinksOf(index, 'a')).toEqual([])
  })

  it('reports links that lead nowhere', () => {
    expect(brokenLinksOf(index, 'b')).toEqual(['nowhere'])
    expect(brokenLinksOf(index, 'a')).toEqual([])
  })

  it('resolves a hand-written target to a page', () => {
    expect(resolveLink(index, '  Product Meeting ')?.id).toBe('target')
    expect(resolveLink(index, 'nowhere')).toBeUndefined()
    expect(resolveLink(index, '  ')).toBeUndefined()
  })

  it('gives an untitled page no backlinks', () => {
    // Otherwise every page linking to "" would point at it.
    const withUntitled = withDoc(index, 'untitled', '', 'body')
    expect(backlinksOf(withUntitled, 'untitled')).toEqual([])
  })
})

describe('tags', () => {
  const index = [
    ['a', 'Monday', '#project #urgent'],
    ['b', 'Tuesday', '#project'],
    ['c', 'Wednesday', 'no tag'],
  ].reduce(
    (acc, [id, title, body]) => withDoc(acc, id as DocId, title as string, body as string),
    EMPTY_INDEX,
  )

  it('counts tags, most used first', () => {
    expect(allTags(index)).toEqual([
      { tag: 'project', count: 2 },
      { tag: 'urgent', count: 1 },
    ])
  })

  it('lists the pages carrying a tag', () => {
    expect(ids(docsWithTag(index, '#PROJECT'.slice(1))).toSorted()).toEqual(['a', 'b'])
    expect(docsWithTag(index, 'nothing')).toEqual([])
  })
})
