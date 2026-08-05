import { describe, expect, it } from 'vitest'
import { exportedHeadingLevel } from './headings'

/**
 * The rule, apart from the DOM that applies it.
 *
 * `toExternalHTML` needs a document to rename an element in, which this project
 * does not have under test — it runs on Node, without jsdom, on purpose. The
 * arithmetic is the part that can be wrong in a way nobody notices, so it lives
 * in a function of its own and is checked here.
 */

describe('a heading of the body, once it is outside Nook', () => {
  it('leaves one rung below the level it sits at', () => {
    expect(exportedHeadingLevel(1)).toBe(2)
    expect(exportedHeadingLevel(2)).toBe(3)
    expect(exportedHeadingLevel(3)).toBe(4)
  })

  it('never claims the level the page title holds', () => {
    // The whole point: whatever a page contains, `# ` in the exported file is
    // the title and nothing else.
    for (let level = 1; level <= 6; level++) {
      expect(exportedHeadingLevel(level)).toBeGreaterThan(1)
    }
  })

  it('stops at the deepest heading HTML has', () => {
    // A page written before the editor offered three levels can hold a level 6.
    // There is no `h7` to demote it to, so it stays where it is — still not an
    // `h1`, which is the only guarantee that matters here.
    expect(exportedHeadingLevel(5)).toBe(6)
    expect(exportedHeadingLevel(6)).toBe(6)
  })

  it('treats a level below 1 as a first-level heading', () => {
    // Not reachable from the editor, but the level arrives from stored JSON,
    // and a document hand-edited into holding a 0 must not produce `h1`.
    expect(exportedHeadingLevel(0)).toBe(2)
    expect(exportedHeadingLevel(-3)).toBe(2)
  })
})
