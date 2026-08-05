import { describe, expect, it } from 'vitest'
import { describeVersion } from './version'

const version = (patch: Partial<Parameters<typeof describeVersion>[0]> = {}) => ({
  number: '0.1.0',
  commit: 'a081ec2',
  date: '2026-08-05T18:52:00Z',
  ...patch,
})

describe('the version line', () => {
  it('names the number, the commit and the day', () => {
    expect(describeVersion(version())).toBe('0.1.0 · a081ec2 · Aug 5, 2026')
  })

  it('says the build is dated rather than inventing a commit', () => {
    // A container image is built without `.git/` in its context. Printing
    // `unknown` beside a date would read as "the commit is unknown but the date
    // is the commit's", which is one claim too many.
    expect(describeVersion(version({ commit: 'unknown' }))).toBe('0.1.0 · built Aug 5, 2026')
  })

  it('survives a date it cannot read', () => {
    // Nothing here is worth a blank settings panel or a thrown error.
    expect(describeVersion(version({ date: 'not a date' }))).toBe('0.1.0 · a081ec2 · unknown date')
  })
})
