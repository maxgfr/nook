import { describe, expect, it } from 'vitest'
import {
  clearStore,
  deleteDatabase,
  listKeys,
  openDatabase,
  read,
  readAll,
  remove,
  write,
  writeBatch,
} from './idb'

/**
 * fake-indexeddb shares a single origin across all tests: each test therefore
 * opens its own database so that none depends on execution order.
 */
let counter = 0
const freshDatabase = () => openDatabase(`nook-test-${++counter}`)

describe('base locale', () => {
  it('creates every expected store', async () => {
    const db = await freshDatabase()

    expect([...db.objectStoreNames].toSorted()).toEqual(['blobs', 'docs', 'index', 'meta'])
  })

  it('reads back what was written', async () => {
    const db = await freshDatabase()

    await write(db, 'docs', 'a', { title: 'Note A' })

    expect(await read(db, 'docs', 'a')).toEqual({ title: 'Note A' })
  })

  it('returns undefined for a missing key', async () => {
    const db = await freshDatabase()

    expect(await read(db, 'docs', 'ghost')).toBeUndefined()
  })

  it('keeps the raw bytes intact', async () => {
    const db = await freshDatabase()
    const enveloppe = { v: 1, iv: new Uint8Array([1, 2, 3]), ct: new Uint8Array([9, 8, 7]) }

    await write(db, 'docs', 'a', enveloppe)
    const back = await read<typeof enveloppe>(db, 'docs', 'a')

    // If structured cloning degraded Uint8Array, the whole encryption scheme
    // would collapse in silence: this test locks that assumption down.
    expect(back?.iv).toBeInstanceOf(Uint8Array)
    expect([...(back?.ct ?? [])]).toEqual([9, 8, 7])
  })

  it('lists the keys and values of a store', async () => {
    const db = await freshDatabase()

    await write(db, 'docs', 'b', 2)
    await write(db, 'docs', 'a', 1)

    expect(await listKeys(db, 'docs')).toEqual(['a', 'b'])
    expect(await readAll(db, 'docs')).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
    ])
  })

  it('deletes a key', async () => {
    const db = await freshDatabase()
    await write(db, 'docs', 'a', 1)

    await remove(db, 'docs', 'a')

    expect(await read(db, 'docs', 'a')).toBeUndefined()
  })

  it('clears one store without touching the others', async () => {
    const db = await freshDatabase()
    await write(db, 'docs', 'a', 1)
    await write(db, 'meta', 'vault', { schema: 1 })

    await clearStore(db, 'docs')

    expect(await listKeys(db, 'docs')).toEqual([])
    expect(await read(db, 'meta', 'vault')).toEqual({ schema: 1 })
  })

  describe('batched write', () => {
    it('writes to several stores in one go', async () => {
      const db = await freshDatabase()

      await writeBatch(db, [
        { op: 'put', store: 'docs', key: 'a', value: { title: 'A' } },
        { op: 'put', store: 'index', key: 'arbre', value: ['a'] },
      ])

      expect(await read(db, 'docs', 'a')).toEqual({ title: 'A' })
      expect(await read(db, 'index', 'arbre')).toEqual(['a'])
    })

    it('mixes writes and deletes', async () => {
      const db = await freshDatabase()
      await write(db, 'docs', 'ancien', 1)

      await writeBatch(db, [
        { op: 'delete', store: 'docs', key: 'ancien' },
        { op: 'put', store: 'docs', key: 'nouveau', value: 2 },
      ])

      expect(await listKeys(db, 'docs')).toEqual(['nouveau'])
    })

    it('does nothing on an empty batch', async () => {
      const db = await freshDatabase()

      await expect(writeBatch(db, [])).resolves.toBeUndefined()
    })
  })

  it('deletes the database without complaining when it does not exist', async () => {
    await expect(deleteDatabase('nook-test-inexistante')).resolves.toBeUndefined()
  })

  it('really deletes an existing database', async () => {
    const name = `nook-test-jetable-${++counter}`
    const db = await openDatabase(name)
    await write(db, 'docs', 'a', 1)
    db.close()

    await deleteDatabase(name)

    // Reopening creates an empty database: proof the old one is gone.
    const reopened = await openDatabase(name)
    expect(await listKeys(reopened, 'docs')).toEqual([])
  })
})
