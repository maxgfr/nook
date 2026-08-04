/**
 * Accès à IndexedDB.
 *
 * Volontairement étroit : ouvrir, lire, écrire, effacer. Aucune notion de
 * document, de chiffrement ou d'interface n'entre ici — ce module ne sait
 * manipuler que des paires clé/valeur opaques.
 *
 * Une contrainte d'IndexedDB gouverne la forme de cette API : une transaction
 * s'auto-referme dès que la file de microtâches se vide sans requête en
 * attente. Attendre une promesse non-IndexedDB au milieu d'une transaction la
 * tue donc silencieusement. C'est pour cette raison qu'il n'existe pas ici de
 * `transact(db, fn)` générique : le chiffrement, qui est asynchrone, doit être
 * terminé *avant* d'ouvrir la transaction. `writeBatch` est la seule primitive
 * atomique offerte, et elle ne prend que des valeurs déjà prêtes.
 */

/*
 * `IDBRequest` expose ses résultats par des propriétés `on*` : c'est l'API
 * canonique d'IndexedDB, et chaque requête est à usage unique, donc les
 * arguments habituels en faveur de `addEventListener` (plusieurs abonnés,
 * `{ once: true }`) ne s'appliquent pas ici.
 */
/* oxlint-disable unicorn/prefer-add-event-listener */

export const DB_NAME = 'nook'
export const DB_VERSION = 1

/**
 * - `meta`   : version de schéma, sel de dérivation, clé maîtresse enveloppée.
 *              Le seul magasin lisible sans déverrouillage — il ne contient
 *              rien d'exploitable sans le secret.
 * - `index`  : un unique enregistrement chiffré (arbre, titres, tags, liens,
 *              index de recherche). Déchiffré au déverrouillage.
 * - `docs`   : un enregistrement chiffré par document.
 * - `blobs`  : un enregistrement chiffré par image ou pièce jointe.
 */
export const STORES = ['meta', 'index', 'docs', 'blobs'] as const
export type StoreName = (typeof STORES)[number]

/**
 * Migrations, indexées par version cible. L'entrée 0 fait passer à la v1.
 * Ajouter une version = ajouter une fonction ici et incrémenter DB_VERSION ;
 * les bases existantes rejouent uniquement les étapes qui leur manquent.
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
    req.onerror = () => reject(new StorageError(`${what} a échoué.`, { cause: req.error }))
  })
}

function settled(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new StorageError(`${what} a échoué.`, { cause: tx.error }))
    tx.onabort = () => reject(new StorageError(`${what} a été interrompu.`, { cause: tx.error }))
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

    // Un autre onglet garde une version antérieure ouverte. Sans ce message,
    // l'utilisateur voit une application qui ne démarre jamais, sans raison.
    req.onblocked = () =>
      reject(
        new StorageError(
          'Une autre fenêtre de Nook utilise une version antérieure de la base. Fermez-la puis rechargez.',
        ),
      )

    req.onsuccess = () => {
      const db = req.result
      // Si un autre onglet réclame une mise à niveau, on libère la base plutôt
      // que de le bloquer indéfiniment.
      db.onversionchange = () => db.close()
      resolve(db)
    }

    req.onerror = () =>
      reject(new StorageError('Impossible d’ouvrir la base locale.', { cause: req.error }))
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
    promisify(objectStore.getAllKeys(), `Lecture des clés de ${store}`),
    promisify<T[]>(objectStore.getAll(), `Lecture de ${store}`),
  ])
  return keys.map((key, i) => ({ key: String(key), value: values[i] as T }))
}

export async function listKeys(db: IDBDatabase, store: StoreName): Promise<string[]> {
  const tx = db.transaction(store, 'readonly')
  const keys = await promisify(tx.objectStore(store).getAllKeys(), `Lecture des clés de ${store}`)
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
  return settled(tx, `Écriture de ${store}/${key}`)
}

export type BatchEntry =
  | { op: 'put'; store: StoreName; key: string; value: unknown }
  | { op: 'delete'; store: StoreName; key: string }

/**
 * Écrit ou supprime plusieurs enregistrements en une seule transaction.
 *
 * C'est la primitive qui garantit qu'un document et l'index qui le référence
 * ne peuvent pas diverger : soit les deux sont écrits, soit aucun. Toutes les
 * valeurs doivent déjà être chiffrées — voir la note en tête de fichier.
 */
export async function writeBatch(db: IDBDatabase, entries: readonly BatchEntry[]): Promise<void> {
  if (entries.length === 0) return
  const stores = [...new Set(entries.map((e) => e.store))]
  const tx = db.transaction(stores, 'readwrite')
  for (const entry of entries) {
    const objectStore = tx.objectStore(entry.store)
    // Explicite plutôt que « tout ce qui n'est pas un put est un delete » :
    // une entrée malformée doit faire du bruit, pas effacer une donnée.
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
        throw new StorageError(`Opération inconnue « ${String(unknown.op)} » sur ${unknown.store}.`)
      }
    }
  }
  return settled(tx, `Écriture groupée de ${entries.length} enregistrement(s)`)
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
 * Demande au navigateur de ne pas évincer nos données.
 *
 * Sans cela, Safari efface le stockage d'une origine restée inactive quelques
 * semaines — un carnet de notes qu'on n'ouvre pas pendant les vacances peut
 * donc disparaître. La demande peut être refusée sans explication ; l'appelant
 * doit s'en servir pour inciter à l'export, pas pour paniquer.
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
    // Une base bloquée finit par être supprimée quand le dernier onglet la
    // relâche ; considérer cela comme un échec ferait paniquer l'appelant à
    // tort, alors qu'il vient de demander une destruction.
    req.onblocked = () => resolve()
    req.onerror = () =>
      reject(new StorageError('Impossible de supprimer la base locale.', { cause: req.error }))
  })
}
