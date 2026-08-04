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
 * fake-indexeddb partage une origine unique entre tous les tests : chaque test
 * ouvre donc sa propre base pour qu'aucun ne dépende de l'ordre d'exécution.
 */
let counter = 0
const freshDatabase = () => openDatabase(`nook-test-${++counter}`)

describe('base locale', () => {
  it('crée tous les magasins attendus', async () => {
    const db = await freshDatabase()

    expect([...db.objectStoreNames].toSorted()).toEqual(['blobs', 'docs', 'index', 'meta'])
  })

  it('relit ce qu’on a écrit', async () => {
    const db = await freshDatabase()

    await write(db, 'docs', 'a', { titre: 'Note A' })

    expect(await read(db, 'docs', 'a')).toEqual({ titre: 'Note A' })
  })

  it('renvoie undefined pour une clé absente', async () => {
    const db = await freshDatabase()

    expect(await read(db, 'docs', 'fantôme')).toBeUndefined()
  })

  it('conserve les octets bruts intacts', async () => {
    const db = await freshDatabase()
    const enveloppe = { v: 1, iv: new Uint8Array([1, 2, 3]), ct: new Uint8Array([9, 8, 7]) }

    await write(db, 'docs', 'a', enveloppe)
    const back = await read<typeof enveloppe>(db, 'docs', 'a')

    // Si le clonage structuré dégradait les Uint8Array, tout le chiffrement
    // s'effondrerait en silence : ce test verrouille cette hypothèse.
    expect(back?.iv).toBeInstanceOf(Uint8Array)
    expect([...(back?.ct ?? [])]).toEqual([9, 8, 7])
  })

  it('liste les clés et les valeurs d’un magasin', async () => {
    const db = await freshDatabase()

    await write(db, 'docs', 'b', 2)
    await write(db, 'docs', 'a', 1)

    expect(await listKeys(db, 'docs')).toEqual(['a', 'b'])
    expect(await readAll(db, 'docs')).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
    ])
  })

  it('supprime une clé', async () => {
    const db = await freshDatabase()
    await write(db, 'docs', 'a', 1)

    await remove(db, 'docs', 'a')

    expect(await read(db, 'docs', 'a')).toBeUndefined()
  })

  it('vide un magasin sans toucher aux autres', async () => {
    const db = await freshDatabase()
    await write(db, 'docs', 'a', 1)
    await write(db, 'meta', 'vault', { schema: 1 })

    await clearStore(db, 'docs')

    expect(await listKeys(db, 'docs')).toEqual([])
    expect(await read(db, 'meta', 'vault')).toEqual({ schema: 1 })
  })

  describe('écriture groupée', () => {
    it('écrit dans plusieurs magasins d’un seul geste', async () => {
      const db = await freshDatabase()

      await writeBatch(db, [
        { op: 'put', store: 'docs', key: 'a', value: { titre: 'A' } },
        { op: 'put', store: 'index', key: 'arbre', value: ['a'] },
      ])

      expect(await read(db, 'docs', 'a')).toEqual({ titre: 'A' })
      expect(await read(db, 'index', 'arbre')).toEqual(['a'])
    })

    it('mélange écritures et suppressions', async () => {
      const db = await freshDatabase()
      await write(db, 'docs', 'ancien', 1)

      await writeBatch(db, [
        { op: 'delete', store: 'docs', key: 'ancien' },
        { op: 'put', store: 'docs', key: 'nouveau', value: 2 },
      ])

      expect(await listKeys(db, 'docs')).toEqual(['nouveau'])
    })

    it('ne fait rien sur un lot vide', async () => {
      const db = await freshDatabase()

      await expect(writeBatch(db, [])).resolves.toBeUndefined()
    })
  })

  it('supprime la base sans broncher si elle n’existe pas', async () => {
    await expect(deleteDatabase('nook-test-inexistante')).resolves.toBeUndefined()
  })

  it('supprime réellement une base existante', async () => {
    const name = `nook-test-jetable-${++counter}`
    const db = await openDatabase(name)
    await write(db, 'docs', 'a', 1)
    db.close()

    await deleteDatabase(name)

    // Rouvrir recrée une base vide : la preuve que l'ancienne a disparu.
    const reopened = await openDatabase(name)
    expect(await listKeys(reopened, 'docs')).toEqual([])
  })
})
