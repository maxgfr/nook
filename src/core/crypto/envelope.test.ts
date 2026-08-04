import { describe, expect, it } from 'vitest'
import {
  DecryptionError,
  ENVELOPE_VERSION,
  isEnvelope,
  open,
  openJson,
  randomBytes,
  seal,
  sealJson,
} from './envelope'

function key() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

describe('sealed envelope', () => {
  it('returns exactly what it was given', async () => {
    const k = await key()
    const secret = bytes('Thursday, without fail.')

    const sealed = await seal(k, secret, 'docs/abc')

    expect(text(await open(k, sealed, 'docs/abc'))).toBe('Thursday, without fail.')
  })

  it('does not let the plain text show through the envelope', async () => {
    const k = await key()

    const sealed = await seal(k, bytes('door code: 4271'), 'docs/abc')

    expect(text(sealed.ct)).not.toContain('4271')
    expect(sealed.v).toBe(ENVELOPE_VERSION)
    expect(sealed.iv).toHaveLength(12)
  })

  it('draws a fresh nonce on every write', async () => {
    const k = await key()
    const same = bytes('contenu identique')

    const first = await seal(k, same, 'docs/abc')
    const second = await seal(k, same, 'docs/abc')

    // Two encryptions of the same text must be indistinguishable from one
    // another to whoever reads the disk: without a fresh nonce they would be identical
    // and would reveal that no change had taken place.
    expect(first.iv).not.toEqual(second.iv)
    expect(first.ct).not.toEqual(second.ct)
  })

  it('refuses a different key', async () => {
    const sealed = await seal(await key(), bytes('secret'), 'docs/abc')

    await expect(open(await key(), sealed, 'docs/abc')).rejects.toThrow(DecryptionError)
  })

  it('refuses an envelope moved elsewhere', async () => {
    const k = await key()
    const sealed = await seal(k, bytes("A's notes"), 'docs/A')

    // Copying A's content into B's location must fail: that is
    // the entire point of binding the envelope to its position.
    await expect(open(k, sealed, 'docs/B')).rejects.toThrow(DecryptionError)
  })

  it('refuses a tampered envelope', async () => {
    const k = await key()
    const sealed = await seal(k, bytes('solde : 1000'), 'docs/abc')

    const corrupted = new Uint8Array(sealed.ct)
    corrupted.set([(corrupted[0] ?? 0) ^ 0xff], 0)

    await expect(open(k, { ...sealed, ct: corrupted }, 'docs/abc')).rejects.toThrow(DecryptionError)
  })

  it('refuses an envelope from another version of the format', async () => {
    const k = await key()
    const sealed = await seal(k, bytes('secret'), 'docs/abc')

    await expect(open(k, { ...sealed, v: 99 }, 'docs/abc')).rejects.toThrow(/version 99/)
  })

  it('refuses a record that is not an envelope', async () => {
    const k = await key()

    await expect(
      open(k, { nope: true } as unknown as Parameters<typeof open>[1], 'docs/abc'),
    ).rejects.toThrow(/not a Nook envelope/)
  })

  it('recognises the shape of an envelope', async () => {
    const sealed = await seal(await key(), bytes('x'), 'docs/abc')

    expect(isEnvelope(sealed)).toBe(true)
    expect(isEnvelope({ v: 1, iv: [1, 2, 3], ct: [4] })).toBe(false)
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope('enveloppe')).toBe(false)
  })

  it('round-trips JSON', async () => {
    const k = await key()
    const doc = { title: 'Meeting', tags: ['project', 'urgent'], done: false, notes: null }

    const sealed = await sealJson(k, doc, 'docs/abc')

    expect(await openJson(k, sealed, 'docs/abc')).toEqual(doc)
  })

  it('reports content that decrypted but is unreadable', async () => {
    const k = await key()
    // The GCM tag will be valid: the content really is ours, but it is
    // is not JSON. That is a serialisation bug, and the message should say so.
    const sealed = await seal(k, bytes('{ this is not JSON'), 'docs/abc')

    await expect(openJson(k, sealed, 'docs/abc')).rejects.toThrow(/invalid JSON/)
  })
})

describe('randomBytes', () => {
  it('returns the requested length, and never the same thing twice', () => {
    expect(randomBytes(12)).toHaveLength(12)
    expect(randomBytes(32)).not.toEqual(randomBytes(32))
  })
})
