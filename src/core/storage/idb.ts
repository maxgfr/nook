/**
 * Access to IndexedDB.
 *
 * Deliberately narrow: open, read, write, erase. No notion of a document, of
 * encryption or of the interface gets in here — this module only knows how to
 * handle opaque key/value pairs.
 *
 * One IndexedDB constraint governs the shape of this API: a transaction
 * auto-closes as soon as the microtask queue drains with no request pending.
 * Awaiting a non-IndexedDB promise in the middle of a transaction therefore
 * kills it silently. That is why there is no generic `transact(db, fn)` here:
 * encryption, being asynchronous, must be finished *before* the transaction
 * opens. `writeBatch` is the only atomic primitive on offer, and it takes
 * only values that are already prepared.
 */

/*
 * `IDBRequest` exposes its results through `on*` properties: that is the
 * canonical IndexedDB API, and each request is single-use, so the usual
 * arguments in favour of `addEventListener` (several subscribers,
 * `{ once: true }`) do not apply here.
 */
/* oxlint-disable unicorn/prefer-add-event-listener */

export const DB_NAME = 'nook'
export const DB_VERSION = 1

/**
 * - `meta`   : schema version, derivation salt, wrapped master key.
 *              The only store readable without unlocking — it holds nothing
 *              usable without the secret.
 * - `index`  : a single encrypted record (tree, titles, tags, links, search
 *              index). Decrypted on unlock.
 * - `docs`   : one encrypted record per document.
 * - `blobs`  : one encrypted record per image or attachment.
 */
export const STORES = ['meta', 'index', 'docs', 'blobs'] as const
export type StoreName = (typeof STORES)[number]

/**
 * Migrations, indexed by target version. Entry 0 moves to v1. Adding a
 * version means adding a function here and bumping DB_VERSION; existing
 * databases replay only the steps they are missing.
 */
const MIGRATIONS: readonly ((db: IDBDatabase) => void)[] = [
  function toVersion1(db) {
    for (const store of STORES) {
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
    }
  },
]

export class StorageError extends Error {
  override readonly name = 'StorageError'
}

function promisify<T>(req: IDBRequest<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new StorageError(`${what} failed.`, { cause: req.error }))
  })
}

function settled(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new StorageError(`${what} failed.`, { cause: tx.error }))
    tx.onabort = () => reject(new StorageError(`${what} was aborted.`, { cause: tx.error }))
  })
}

export function openDatabase(name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)

    req.onupgradeneeded = (event) => {
      const db = req.result
      const from = event.oldVersion
      for (let version = from; version < DB_VERSION; version++) {
        MIGRATIONS[version]?.(db)
      }
    }

    // Another tab is holding an older version open. Without this message,
    // the user sees an application that never starts, with no explanation.
    req.onblocked = () =>
      reject(
        new StorageError(
          'Another Nook window is using an older version of the database. Close it, then reload.',
        ),
      )

    req.onsuccess = () => {
      const db = req.result
      // If another tab asks for an upgrade, we release the database rather
      // than block it indefinitely.
      db.onversionchange = () => db.close()
      resolve(db)
    }

    req.onerror = () =>
      reject(new StorageError('Could not open the local database.', { cause: req.error }))
  })
}

export async function read<T>(
  db: IDBDatabase,
  store: StoreName,
  key: string,
): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly')
  return promisify<T | undefined>(tx.objectStore(store).get(key), `Lecture de ${store}/${key}`)
}

export async function readAll<T>(
  db: IDBDatabase,
  store: StoreName,
): Promise<{ key: string; value: T }[]> {
  const tx = db.transaction(store, 'readonly')
  const objectStore = tx.objectStore(store)
  const [keys, values] = await Promise.all([
    promisify(objectStore.getAllKeys(), `Reading the keys of ${store}`),
    promisify<T[]>(objectStore.getAll(), `Lecture de ${store}`),
  ])
  return keys.map((key, i) => ({ key: String(key), value: values[i] as T }))
}

export async function listKeys(db: IDBDatabase, store: StoreName): Promise<string[]> {
  const tx = db.transaction(store, 'readonly')
  const keys = await promisify(tx.objectStore(store).getAllKeys(), `Reading the keys of ${store}`)
  return keys.map(String)
}

export async function write(
  db: IDBDatabase,
  store: StoreName,
  key: string,
  value: unknown,
): Promise<void> {
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value, key)
  return settled(tx, `Writing ${store}/${key}`)
}

export type BatchEntry =
  | { op: 'put'; store: StoreName; key: string; value: unknown }
  | { op: 'delete'; store: StoreName; key: string }

/**
 * Writes or deletes several records in a single transaction.
 *
 * This is the primitive that guarantees a document and the index referencing
 * it cannot diverge: either both are written, or neither. Every value must
 * already be encrypted — see the note at the top of this file.
 */
export async function writeBatch(db: IDBDatabase, entries: readonly BatchEntry[]): Promise<void> {
  if (entries.length === 0) return
  const stores = [...new Set(entries.map((e) => e.store))]
  const tx = db.transaction(stores, 'readwrite')
  for (const entry of entries) {
    const objectStore = tx.objectStore(entry.store)
    // Explicit rather than "anything that is not a put is a delete":
    // a malformed entry must make noise, not erase data.
    switch (entry.op) {
      case 'put':
        objectStore.put(entry.value, entry.key)
        break
      case 'delete':
        objectStore.delete(entry.key)
        break
      default: {
        const unknown = entry as BatchEntry
        tx.abort()
        throw new StorageError(`Unknown operation "${String(unknown.op)}" on ${unknown.store}.`)
      }
    }
  }
  return settled(tx, `Batched write of ${entries.length} record(s)`)
}

export async function remove(db: IDBDatabase, store: StoreName, key: string): Promise<void> {
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  return settled(tx, `Suppression de ${store}/${key}`)
}

export async function clearStore(db: IDBDatabase, store: StoreName): Promise<void> {
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).clear()
  return settled(tx, `Vidage de ${store}`)
}

/**
 * Ask the browser not to evict our data.
 *
 * Without this, Safari clears the storage of an origin left idle for a few
 * weeks — a notebook you don't open over the holidays can therefore vanish.
 * The request may be denied without explanation; the caller should use that
 * to encourage exporting, not to panic.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export function deleteDatabase(name: string = DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    // A blocked database is eventually deleted once the last tab
    // releases it; treating that as a failure would make the caller panic
    // wrongly, when they have just asked for a destruction.
    req.onblocked = () => resolve()
    req.onerror = () =>
      reject(new StorageError('Could not delete the local database.', { cause: req.error }))
  })
}
