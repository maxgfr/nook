import { describe, expect, it } from 'vitest'
import {
  SUGGESTION_BITS,
  SUGGESTION_SEPARATOR,
  suggestPassphrase,
  WORDS,
  WORDS_PER_SUGGESTION,
} from './wordlist'
import { checkPassphrase } from './kdf'

describe('the word list', () => {
  it('holds exactly 256 words', () => {
    // Not a round number for its own sake: one random byte then selects one
    // word with no arithmetic, so there is no modulo and no bias. Any other
    // size needs rejection sampling to make the same claim.
    expect(WORDS).toHaveLength(256)
  })

  it('holds no duplicates', () => {
    // A repeated word is a silent loss of entropy: the list would still have
    // 256 entries and fewer than 256 outcomes, and nothing else would notice.
    expect(new Set(WORDS).size).toBe(WORDS.length)
  })

  it('holds only plain lowercase letters', () => {
    // Anything else — an accent, an apostrophe, a capital — turns "read it
    // down the phone" into "spell it out", which is the whole point lost.
    expect(WORDS.filter((word) => !/^[a-z]{3,5}$/.test(word))).toEqual([])
  })
})

describe('suggesting a passphrase', () => {
  it('offers six words joined by hyphens', () => {
    const suggestion = suggestPassphrase()
    const parts = suggestion.split(SUGGESTION_SEPARATOR)

    expect(parts).toHaveLength(WORDS_PER_SUGGESTION)
    expect(parts.every((part) => WORDS.includes(part))).toBe(true)
  })

  it('offers something the vault would accept', () => {
    // A suggestion the application then refuses would be a joke at the
    // reader's expense.
    expect(() => checkPassphrase(suggestPassphrase())).not.toThrow()
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => suggestPassphrase()))
    expect(seen.size).toBe(50)
  })

  it('claims the entropy it actually has', () => {
    expect(SUGGESTION_BITS).toBe(WORDS_PER_SUGGESTION * Math.log2(WORDS.length))
  })
})
