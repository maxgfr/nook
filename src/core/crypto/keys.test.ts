import { describe, expect, it } from 'vitest'
import { openDatabase, read, remove, write } from '../storage/idb'
import { createVault, openVault, readVaultMeta, VaultError } from './keys'
import { open, seal } from './envelope'

let counter = 0
const freshDatabase = () => openDatabase(`nook-keys-${++counter}`)

/** Frozen timestamp: the creation date must be the one we supplied. */
const CREATED_AT = '2026-08-04T10:00:00.000Z'

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

describe('coffre', () => {
  it('does not exist before it has been created', async () => {
    const db = await freshDatabase()

    expect(await openVault(db)).toBeUndefined()
    expect(await readVaultMeta(db)).toBeUndefined()
  })

  it('is created with a usable key and a readable description', async () => {
    const db = await freshDatabase()

    const key = await createVault(db, new Date(CREATED_AT))

    expect(await readVaultMeta(db)).toEqual({
      schema: 1,
      protection: { kind: 'device' },
      createdAt: CREATED_AT,
    })
    expect(text(await open(key, await seal(key, bytes('test'), 'docs/a'), 'docs/a'))).toBe('test')
  })

  it('produces a key JavaScript cannot read', async () => {
    const db = await freshDatabase()

    const key = await createVault(db)

    // The heart of the promise: not even code running inside the page can
    // exfiltrate the key's bytes.
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })

  it('refuses to overwrite an existing vault', async () => {
    const db = await freshDatabase()
    await createVault(db)

    // A second call would reset the key and make every note
    // permanently unreadable. It must fail loudly.
    await expect(createVault(db)).rejects.toThrow(VaultError)
  })

  it('reopens the vault with the same key', async () => {
    const db = await freshDatabase()
    const created = await createVault(db)
    const sealed = await seal(created, bytes("yesterday's note"), 'docs/a')

    const reopened = await openVault(db)

    expect(reopened).toBeDefined()
    expect(text(await open(reopened!, sealed, 'docs/a'))).toBe("yesterday's note")
  })

  it('says plainly what happens when the key has vanished', async () => {
    const db = await freshDatabase()
    await createVault(db)

    await remove(db, 'meta', 'deviceKey')

    // Unrecoverable case: the message must point towards an export rather than
    // suggest a passing incident.
    await expect(openVault(db)).rejects.toThrow(/unrecoverable|export/)
  })

  it('refuses a vault written by a newer version', async () => {
    const db = await freshDatabase()
    await createVault(db)

    const meta = await read<Record<string, unknown>>(db, 'meta', 'vault')
    await write(db, 'meta', 'vault', { ...meta, schema: 2 })

    await expect(openVault(db)).rejects.toThrow(/newer version/)
  })

  it("keeps two devices' vaults apart", async () => {
    const appareilA = await freshDatabase()
    const appareilB = await freshDatabase()
    const keyA = await createVault(appareilA)
    const keyB = await createVault(appareilB)

    const sealedByA = await seal(keyA, bytes('journal intime'), 'docs/a')

    await expect(open(keyB, sealedByA, 'docs/a')).rejects.toThrow()
  })
})
