import { describe, expect, it } from 'vitest'
import { referencedBlobIds } from './blobs'

describe('finding the files a page refers to', () => {
  it('finds a reference wherever it sits in the tree', () => {
    // Structural on purpose: the core does not know which key an editor puts a
    // picture's address under, and must keep working when that changes.
    const content = [
      { type: 'image', props: { url: 'nook:one' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'nothing here' }] },
      { deeply: { nested: [{ url: 'nook:two' }] } },
    ]
    expect(referencedBlobIds(content).toSorted()).toEqual(['one', 'two'])
  })

  it('returns each file once, however often it appears', () => {
    const content = [{ url: 'nook:same' }, { url: 'nook:same' }]
    expect(referencedBlobIds(content)).toEqual(['same'])
  })

  it.each([
    ['an ordinary web address', 'https://example.com/a.png'],
    ['inline bytes', 'data:image/png;base64,AAAA'],
    ['a blob URL', 'blob:http://localhost/abc'],
    ['a bare prefix with no identifier', 'nook:'],
    ['the word in prose', 'I keep my nook: tidy'],
  ])('ignores %s', (_why, url) => {
    expect(referencedBlobIds([{ url }])).toEqual([])
  })

  it.each([
    ['nothing', []],
    ['null', null],
    ['a plain string', 'hello'],
    ['a number', 42],
  ])('copes with %s', (_why, content) => {
    expect(referencedBlobIds(content as never)).toEqual([])
  })
})
