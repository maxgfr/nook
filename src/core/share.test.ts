import { describe, expect, it } from 'vitest'
import {
  decodeShare,
  encodeShare,
  fitsInLink,
  isPastNotAfter,
  isSealed,
  LINK_LIMIT_BYTES,
  packShare,
  ShareError,
  unpackShare,
  type ShareKdf,
  type SharedPage,
} from './share'
import { DecryptionError } from './crypto/envelope'
import { PassphraseError } from './crypto/kdf'
import { toBase64 } from './base64'

const PASSPHRASE = 'a sentence I will remember'

const PAGE: SharedPage = {
  title: 'Product meeting',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We agreed on the date.' }] }],
  files: [],
  sharedAt: '2026-03-01T10:00:00.000Z',
}

describe('packing and unpacking a share', () => {
  it('comes back exactly as it went in', async () => {
    const packed = await packShare(PAGE, PASSPHRASE)
    expect(await unpackShare(packed, PASSPHRASE)).toEqual(PAGE)
  })

  it('carries the files with it', async () => {
    const page: SharedPage = {
      ...PAGE,
      files: [
        {
          id: 'abc',
          name: 'chart.png',
          type: 'image/png',
          base64: toBase64(new Uint8Array([1, 2, 3])),
        },
      ],
    }
    // A share that silently dropped the pictures would look complete and open
    // as a page full of holes.
    expect((await unpackShare(await packShare(page, PASSPHRASE), PASSPHRASE)).files).toEqual(
      page.files,
    )
  })

  it('carries the sender’s note and requested date', async () => {
    const page: SharedPage = { ...PAGE, notAfter: '2026-04-01T00:00:00.000Z', note: 'For Tuesday.' }
    const back = await unpackShare(await packShare(page, PASSPHRASE), PASSPHRASE)
    expect(back.notAfter).toBe(page.notAfter)
    expect(back.note).toBe(page.note)
  })

  it('derives a different key for every share', async () => {
    // Same page, same words. If the salt were fixed, cracking one share would
    // crack every share ever made with that passphrase.
    const first = await packShare(PAGE, PASSPHRASE)
    const second = await packShare(PAGE, PASSPHRASE)
    expect(first.kdf?.salt).not.toBe(second.kdf?.salt)
    expect(first.ct).not.toBe(second.ct)
  })
})

describe('refusing to open', () => {
  it('rejects the wrong passphrase', async () => {
    const packed = await packShare(PAGE, PASSPHRASE)
    await expect(unpackShare(packed, 'some other sentence')).rejects.toThrow(DecryptionError)
  })

  it('rejects a payload whose contents were altered', async () => {
    const packed = await packShare(PAGE, PASSPHRASE)
    const flipped = { ...packed, ct: `${packed.ct.slice(0, -4)}AAAA` }
    // AES-GCM authenticates: a changed byte is a failure, not a silent lie.
    await expect(unpackShare(flipped, PASSPHRASE)).rejects.toThrow(DecryptionError)
  })

  it('rejects a payload whose derivation parameters were altered', async () => {
    const packed = await packShare(PAGE, PASSPHRASE)
    const weakened = { ...packed, kdf: { ...(packed.kdf as ShareKdf), iterations: 1 } }
    await expect(unpackShare(weakened, PASSPHRASE)).rejects.toThrow(DecryptionError)
  })

  it.each([
    ['something that is not a share', { format: 'something-else', version: 1 }],
    ['a share from a later version', { format: 'nook-share', version: 99 }],
    ['a share with no contents', { format: 'nook-share', version: 1, kdf: {}, iv: '', ct: '' }],
  ])('rejects %s', async (_why, payload) => {
    await expect(unpackShare(payload as never, PASSPHRASE)).rejects.toThrow(ShareError)
  })

  it('refuses a passphrase too short to be one', async () => {
    // A short passphrase is worse than none: it looks like protection and is
    // not. Sending nothing at all is a choice someone can make knowingly;
    // `Password1` is a choice they think they have already made.
    await expect(packShare(PAGE, 'short')).rejects.toThrow(PassphraseError)
  })
})

describe('sharing without a passphrase', () => {
  it('is allowed, and says so in the payload', async () => {
    const packed = await packShare(PAGE, '')

    // `kdf: null` is how both ends know there is nothing to ask for, and how
    // the reader knows to say the page arrived unprotected.
    expect(packed.kdf).toBeNull()
    expect(isSealed(packed)).toBe(false)
  })

  it('opens with no passphrase at all', async () => {
    expect(await unpackShare(await packShare(PAGE, ''), '')).toEqual(PAGE)
  })

  it('opens whatever anyone types, because nothing is checked', async () => {
    // Not a defect to fix — a fact to state. There is no key, so there is no
    // wrong answer, and pretending otherwise would be theatre.
    expect(await unpackShare(await packShare(PAGE, ''), 'anything at all')).toEqual(PAGE)
  })

  it('is readable by anyone holding the link', async () => {
    const encoded = encodeShare(await packShare(PAGE, ''))

    // Base64 is an encoding, not a lock. This test exists so that nobody can
    // later describe an unsealed share as "obfuscated" and be believed.
    expect(JSON.stringify(decodeShare(encoded))).toContain(
      Buffer.from(JSON.stringify(PAGE)).toString('base64').slice(0, 24),
    )
  })

  it('still travels as a sealed share when a passphrase is given', async () => {
    const sealed = await packShare(PAGE, PASSPHRASE)
    expect(isSealed(sealed)).toBe(true)
    expect(JSON.stringify(sealed)).not.toContain('agreed on the date')
  })
})

describe('the text that travels', () => {
  it('survives the trip through a URL fragment', async () => {
    const packed = await packShare(PAGE, PASSPHRASE)
    const encoded = encodeShare(packed)

    expect(encoded).toMatch(/^[\w-]+$/)
    expect(encoded).toBe(encodeURIComponent(encoded))
    expect(decodeShare(encoded)).toEqual(packed)
  })

  it('opens after being encoded and decoded', async () => {
    const encoded = encodeShare(await packShare(PAGE, PASSPHRASE))
    expect(await unpackShare(decodeShare(encoded), PASSPHRASE)).toEqual(PAGE)
  })

  it.each([
    ['a truncated link', 'eyJmb3JtYXQiOiJub29rLXNoYXJl'],
    ['something else entirely', 'hello there'],
    ['nothing at all', ''],
  ])('says so plainly when handed %s', (_why, text) => {
    expect(() => decodeShare(text)).toThrow(ShareError)
  })

  it('offers a link only while a link would arrive intact', () => {
    expect(fitsInLink('x'.repeat(LINK_LIMIT_BYTES))).toBe(true)
    expect(fitsInLink('x'.repeat(LINK_LIMIT_BYTES + 1))).toBe(false)
  })
})

const at = (iso: string) => new Date(iso)

describe('the date the sender asked for', () => {
  it('is not past when none was given', () => {
    expect(isPastNotAfter(PAGE, at('2099-01-01T00:00:00.000Z'))).toBe(false)
  })

  it('is past once the day has gone by', () => {
    const page = { ...PAGE, notAfter: '2026-04-01T00:00:00.000Z' }
    expect(isPastNotAfter(page, at('2026-03-31T23:59:59.000Z'))).toBe(false)
    expect(isPastNotAfter(page, at('2026-04-01T00:00:01.000Z'))).toBe(true)
  })

  it('is not past when the date is unreadable', () => {
    // A date nobody can parse must not lock a page: the sender asked for
    // something, and what they asked for cannot be determined. Refusing to show
    // the page would enforce a rule that was never stated.
    expect(isPastNotAfter({ ...PAGE, notAfter: 'next Tuesday' })).toBe(false)
  })
})

describe('what this module deliberately cannot do', () => {
  it('has no way to revoke anything', async () => {
    // A shared page is a copy on somebody else's machine. A `revoke` function
    // would have to be a lie, so there is none — and this test is here to fail
    // if one is ever added without the promise being revisited.
    const share = await import('./share')
    const names = Object.keys(share).map((name) => name.toLowerCase())
    expect(names.filter((name) => name.includes('revoke') || name.includes('expire'))).toEqual([])
  })
})
