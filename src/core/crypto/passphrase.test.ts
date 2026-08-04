import { describe, expect, it } from 'vitest'
import { Vault } from '../vault'
import { checkPassphrase, MIN_PASSPHRASE_LENGTH, PassphraseError } from './kdf'
import { openDatabase, read } from '../storage/idb'
import { isEnvelope } from './envelope'

/**
 * Argon2id is deliberately slow, so these tests take a couple of seconds
 * rather than milliseconds. That is the cost being verified, not a defect.
 */

let counter = 0
const name = () => `nook-pass-${++counter}`

const GOOD = 'a sentence I will actually remember'

describe('passphrase rules', () => {
  it('refuses a passphrase short enough to be guessed', () => {
    expect(() => checkPassphrase('short')).toThrow(PassphraseError)
    expect(() => checkPassphrase('x'.repeat(MIN_PASSPHRASE_LENGTH))).not.toThrow()
  })
})

describe('protecting a vault', () => {
  it('starts on device protection', async () => {
    const vault = await Vault.open(name())

    expect(vault.protection.kind).toBe('device')
  })

  it('reports how a vault is protected without opening it', async () => {
    const database = name()
    expect(await Vault.inspect(database)).toBeNull()

    const vault = await Vault.open(database)
    vault.close()

    expect(await Vault.inspect(database)).toEqual({ kind: 'device' })
  })

  it('locks the vault behind a passphrase and reopens it', async () => {
    const database = name()
    const vault = await Vault.open(database)
    const doc = await vault.createDoc({ title: 'Before the lock' })
    await vault.saveDoc(doc.id, { content: [{ text: 'still here afterwards' }] })

    await vault.enablePassphrase(GOOD)
    vault.close()

    expect((await Vault.inspect(database))?.kind).toBe('passphrase')

    const reopened = await Vault.unlock(GOOD, database)
    expect(reopened.index.docs[doc.id]?.title).toBe('Before the lock')
    expect((await reopened.readDoc(doc.id)).content).toEqual([{ text: 'still here afterwards' }])
  }, 20_000)

  it('refuses the wrong passphrase', async () => {
    const database = name()
    const vault = await Vault.open(database)
    await vault.enablePassphrase(GOOD)
    vault.close()

    await expect(Vault.unlock('not the passphrase', database)).rejects.toThrow(/Wrong passphrase/)
  }, 20_000)

  it('refuses to open a passphrase vault without asking', async () => {
    const database = name()
    const vault = await Vault.open(database)
    await vault.enablePassphrase(GOOD)
    vault.close()

    await expect(Vault.open(database)).rejects.toThrow(/protected by a passphrase/)
  }, 20_000)

  it('destroys the device key, so the old way in is gone', async () => {
    const database = name()
    const vault = await Vault.open(database)
    await vault.enablePassphrase(GOOD)
    vault.close()

    // The whole point of rotating: what used to open the vault with no secret
    // must no longer exist on disk.
    const raw = await openDatabase(database)
    expect(await read(raw, 'meta', 'deviceKey')).toBeUndefined()
  }, 20_000)

  it('leaves nothing readable on disk', async () => {
    const database = name()
    const vault = await Vault.open(database)
    const doc = await vault.createDoc({ title: 'door code' })
    await vault.saveDoc(doc.id, { content: [{ text: 'the code is 4271' }] })
    await vault.enablePassphrase(GOOD)
    vault.close()

    const raw = await openDatabase(database)
    const stored = await read(raw, 'docs', doc.id)
    expect(isEnvelope(stored)).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('4271')
  }, 20_000)

  it('goes back to device protection, rotating again', async () => {
    const database = name()
    const vault = await Vault.open(database)
    const doc = await vault.createDoc({ title: 'Round trip' })
    await vault.enablePassphrase(GOOD)
    await vault.disablePassphrase()
    vault.close()

    const reopened = await Vault.open(database)
    expect(reopened.index.docs[doc.id]?.title).toBe('Round trip')
    expect(reopened.protection.kind).toBe('device')
  }, 30_000)

  it('refuses to lock twice', async () => {
    const vault = await Vault.open(name())
    await vault.enablePassphrase(GOOD)

    await expect(vault.enablePassphrase(GOOD)).rejects.toThrow(/already protected/)
  }, 20_000)

  it('refuses a weak passphrase before touching any data', async () => {
    const vault = await Vault.open(name())
    const doc = await vault.createDoc({ title: 'Untouched' })

    await expect(vault.enablePassphrase('short')).rejects.toThrow(PassphraseError)

    // The vault must be exactly as it was: a rejected passphrase is not a
    // half-applied rotation.
    expect(vault.protection.kind).toBe('device')
    expect(vault.index.docs[doc.id]?.title).toBe('Untouched')
  })
})
