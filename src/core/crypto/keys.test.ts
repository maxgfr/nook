import { describe, expect, it } from 'vitest'
import { openDatabase, read, remove, write } from '../storage/idb'
import { createVault, openVault, readVaultMeta, VaultError } from './keys'
import { open, seal } from './envelope'

let counter = 0
const freshDatabase = () => openDatabase(`nook-keys-${++counter}`)

/** Horodatage figé : la date de création doit être celle qu'on a fournie. */
const CREATED_AT = '2026-08-04T10:00:00.000Z'

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

describe('coffre', () => {
  it('n’existe pas avant d’avoir été créé', async () => {
    const db = await freshDatabase()

    expect(await openVault(db)).toBeUndefined()
    expect(await readVaultMeta(db)).toBeUndefined()
  })

  it('se crée avec une clé utilisable et une description lisible', async () => {
    const db = await freshDatabase()

    const key = await createVault(db, new Date(CREATED_AT))

    expect(await readVaultMeta(db)).toEqual({
      schema: 1,
      protection: { kind: 'device' },
      createdAt: CREATED_AT,
    })
    expect(text(await open(key, await seal(key, bytes('test'), 'docs/a'), 'docs/a'))).toBe('test')
  })

  it('produit une clé que JavaScript ne peut pas lire', async () => {
    const db = await freshDatabase()

    const key = await createVault(db)

    // Le cœur de la promesse : même du code exécuté dans la page ne peut pas
    // exfiltrer les octets de la clé.
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })

  it('refuse d’écraser un coffre existant', async () => {
    const db = await freshDatabase()
    await createVault(db)

    // Un second appel réinitialiserait la clé et rendrait toutes les notes
    // définitivement illisibles. Il doit échouer bruyamment.
    await expect(createVault(db)).rejects.toThrow(VaultError)
  })

  it('rouvre le coffre avec la même clé', async () => {
    const db = await freshDatabase()
    const created = await createVault(db)
    const sealed = await seal(created, bytes('la note d’hier'), 'docs/a')

    const reopened = await openVault(db)

    expect(reopened).toBeDefined()
    expect(text(await open(reopened!, sealed, 'docs/a'))).toBe('la note d’hier')
  })

  it('dit clairement ce qui se passe si la clé a disparu', async () => {
    const db = await freshDatabase()
    await createVault(db)

    await remove(db, 'meta', 'deviceKey')

    // Cas irrécupérable : le message doit orienter vers un export plutôt que
    // laisser croire à un incident passager.
    await expect(openVault(db)).rejects.toThrow(/irrécupérables|export/)
  })

  it('refuse un coffre écrit par une version plus récente', async () => {
    const db = await freshDatabase()
    await createVault(db)

    const meta = await read<Record<string, unknown>>(db, 'meta', 'vault')
    await write(db, 'meta', 'vault', { ...meta, schema: 2 })

    await expect(openVault(db)).rejects.toThrow(/plus récente/)
  })

  it('sépare les coffres de deux appareils', async () => {
    const appareilA = await freshDatabase()
    const appareilB = await freshDatabase()
    const keyA = await createVault(appareilA)
    const keyB = await createVault(appareilB)

    const sealedByA = await seal(keyA, bytes('journal intime'), 'docs/a')

    await expect(open(keyB, sealedByA, 'docs/a')).rejects.toThrow()
  })
})
