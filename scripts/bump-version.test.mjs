import { describe, expect, it } from 'vitest'
import { bumpFor, nextVersion, withVersion } from './bump-version.mjs'

/**
 * This arithmetic decides a number that nothing downstream checks: the build
 * takes whatever `package.json` says and prints it in the settings panel. An
 * error here surfaces as an interface confidently naming a version that was
 * never released, which is the sort of thing nobody thinks to doubt.
 */

describe('reading a batch of commits', () => {
  it('ignores what makes no claim about the release', () => {
    expect(bumpFor(['Open the page you last wrote in', 'docs: rewrite the readme'])).toBeNull()
  })

  it('takes the loudest of the batch, wherever it sits', () => {
    expect(bumpFor(['fix: a', 'feat: b', 'fix: c'])).toBe('minor')
    expect(bumpFor(['feat: a', 'fix!: b'])).toBe('major')
  })

  it('reads a break from the mark or from the footer', () => {
    expect(bumpFor(['feat(vault)!: rotate the key format'])).toBe('major')
    expect(
      bumpFor(['feat: rotate the key format\n\nBREAKING CHANGE: old vaults need export']),
    ).toBe('major')
  })

  it('will not read a break out of an unprefixed commit', () => {
    // Conventional Commits puts the type first. Guessing from a body alone
    // would make the convention impossible to learn from its own history.
    expect(bumpFor(['Rotate the key format\n\nBREAKING CHANGE: old vaults need export'])).toBeNull()
  })
})

describe('choosing the next number', () => {
  it('moves the part the commits asked for', () => {
    expect(nextVersion('1.4.2', ['fix: a'])).toBe('1.4.3')
    expect(nextVersion('1.4.2', ['feat: a'])).toBe('1.5.0')
    expect(nextVersion('1.4.2', ['feat!: a'])).toBe('2.0.0')
  })

  it('keeps 1.0.0 a decision rather than an accident', () => {
    // Below one, a break moves the minor. Declaring the project stable is a
    // statement a person makes, not one an exclamation mark makes for them.
    expect(nextVersion('0.1.0', ['feat!: a'])).toBe('0.2.0')
  })

  it('stays put when nothing asked for anything', () => {
    expect(nextVersion('0.1.0', ['chore: tidy the workflows'])).toBeNull()
  })

  it('refuses a version it cannot reason about', () => {
    expect(() => nextVersion('0.1.0-beta.2', ['fix: a'])).toThrow(/knows how to bump/)
  })
})

describe('writing it back', () => {
  const manifest = '{\n  "name": "nook",\n  "version": "0.1.0",\n  "private": true\n}\n'

  it('touches the value and nothing else', () => {
    // Everything around the number has to survive byte for byte, or
    // `pnpm format:check` fails on the release commit.
    expect(withVersion(manifest, '0.1.0', '0.2.0')).toBe(
      '{\n  "name": "nook",\n  "version": "0.2.0",\n  "private": true\n}\n',
    )
  })

  it('refuses to guess when the field is not where it expected', () => {
    expect(() => withVersion(manifest, '9.9.9', '10.0.0')).toThrow(/No "version"/)
  })
})
