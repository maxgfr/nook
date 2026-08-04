/**
 * The vault — the only API the interface consumes.
 *
 * Everything underneath (IndexedDB, AES-GCM, the tree, the migrations) is a
 * detail `src/ui` is not allowed to know. A test enforces it: see
 * `core/architecture.test.ts`.
 *
 * Two guarantees are kept here, and nowhere else:
 *
 * 1. **The index and the documents never diverge.** Every mutation encrypts
 *    what it must write, *then* writes the document and the index in a
 *    single transaction. A crash at the wrong moment leaves the previous
 *    state, never an index referencing a missing document.
 *
 * 2. **The index lives in memory, decrypted once.** The sidebar, the command
 *    palette and the breadcrumbs therefore never have to decrypt a document
 *    in order to render.
 */

import { openJson, sealJson, type Envelope } from './crypto/envelope'
import { createVault, openVault } from './crypto/keys'
import {
  openDatabase,
  read,
  requestPersistentStorage,
  writeBatch,
  type BatchEntry,
} from './storage/idb'
import { surveyStorage, wipeEverything, type StorageSurvey } from './storage/wipe'
import {
  childrenOf,
  descendantIdsOf,
  docOrThrow,
  moveDoc,
  nextOrder,
  removeAll,
  upsert,
} from './model/tree'
import {
  EMPTY_INDEX,
  newId,
  UNTITLED,
  type Doc,
  type DocId,
  type DocSummary,
  type JsonValue,
  type VaultIndex,
} from './model/types'

const INDEX_KEY = 'index'
const indexContext = () => `index/${INDEX_KEY}`
const docContext = (id: DocId) => `docs/${id}`

/** Content of a fresh document: an empty paragraph, ready for the caret. */
const EMPTY_CONTENT: JsonValue = []

export type VaultExport = {
  readonly format: 'nook-export'
  readonly version: 1
  readonly exportedAt: string
  readonly docs: readonly Doc[]
}

/**
 * `replace` erases the vault before importing; `merge` keeps what is there and
 * reassigns an identifier to documents that would collide. There is no default
 * mode: overwriting notes must always be an explicit choice.
 */
export type ImportMode = 'replace' | 'merge'

export class Vault {
  // Fields declared then assigned rather than constructor properties:
  // `erasableSyntaxOnly` forbids the latter, because they produce
  // code at runtime and therefore cannot simply be erased by a transpiler
  // transpiler that only strips types.
  readonly #db: IDBDatabase
  readonly #key: CryptoKey
  #index: VaultIndex
  readonly #listeners = new Set<() => void>()

  private constructor(db: IDBDatabase, key: CryptoKey, index: VaultIndex) {
    this.#db = db
    this.#key = key
    this.#index = index
  }

  /** Opens this device's vault, or creates it on the very first launch. */
  static async open(databaseName?: string): Promise<Vault> {
    // Requested as soon as we open, before any write: a refusal blocks nothing,
    // it only makes the notes evictable after a long spell of inactivity.
    void requestPersistentStorage()

    const db = await openDatabase(databaseName)
    const key = (await openVault(db)) ?? (await createVault(db))

    const stored = await read<Envelope>(db, 'index', INDEX_KEY)
    const index = stored ? await openJson<VaultIndex>(key, stored, indexContext()) : EMPTY_INDEX

    return new Vault(db, key, index)
  }

  get index(): VaultIndex {
    return this.#index
  }

  /** Tells the interface it must redraw. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  children(parentId: DocId | null): DocSummary[] {
    return childrenOf(this.#index, parentId)
  }

  async createDoc(options: { parentId?: DocId | null; title?: string } = {}): Promise<DocSummary> {
    const parentId = options.parentId ?? null
    const now = new Date().toISOString()
    const summary: DocSummary = {
      id: newId(),
      parentId,
      title: options.title ?? '',
      icon: null,
      createdAt: now,
      updatedAt: now,
      order: nextOrder(this.#index, parentId),
    }

    await this.#commit(upsert(this.#index, summary), [
      { op: 'put', store: 'docs', key: summary.id, value: { ...summary, content: EMPTY_CONTENT } },
    ])
    return summary
  }

  async readDoc(id: DocId): Promise<Doc> {
    const summary = docOrThrow(this.#index, id)
    const stored = await read<Envelope>(this.#db, 'docs', id)
    if (!stored) {
      throw new Error(`The content of document "${summary.title || UNTITLED}" cannot be found.`)
    }
    const doc = await openJson<Doc>(this.#key, stored, docContext(id))
    // The index is authoritative for metadata: it is what
    // moves and renames update.
    return { ...doc, ...summary }
  }

  async saveDoc(
    id: DocId,
    patch: { title?: string; icon?: string | null; content?: JsonValue },
  ): Promise<DocSummary> {
    const current = await this.readDoc(id)
    const updated: Doc = {
      ...current,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
      ...(patch.content === undefined ? {} : { content: patch.content }),
      updatedAt: new Date().toISOString(),
    }

    const { content: _content, ...summary } = updated
    await this.#commit(upsert(this.#index, summary), [
      { op: 'put', store: 'docs', key: id, value: updated },
    ])
    return summary
  }

  async moveDoc(id: DocId, parentId: DocId | null, position?: number): Promise<void> {
    await this.#commit(moveDoc(this.#index, id, parentId, position), [])
  }

  /**
   * Deletes a document and its whole subtree. Without the cascade, child
   * pages would stay in the database referencing a parent that no longer
   * exists, invisible and never recoverable.
   */
  async deleteDoc(id: DocId): Promise<DocId[]> {
    docOrThrow(this.#index, id)
    const removed = [id, ...descendantIdsOf(this.#index, id)]

    await this.#commit(
      removeAll(this.#index, removed),
      removed.map((docId) => ({ op: 'delete', store: 'docs', key: docId }) as const),
    )
    return removed
  }

  async exportAll(): Promise<VaultExport> {
    const docs = await Promise.all(Object.keys(this.#index.docs).map((id) => this.readDoc(id)))
    return {
      format: 'nook-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      docs,
    }
  }

  async importAll(data: VaultExport, mode: ImportMode): Promise<number> {
    if (data?.format !== 'nook-export' || data.version !== 1) {
      throw new Error('This file is not a Nook export this version can read.')
    }

    let index = mode === 'replace' ? EMPTY_INDEX : this.#index
    const writes: BatchEntry[] = []

    if (mode === 'replace') {
      for (const id of Object.keys(this.#index.docs)) {
        writes.push({ op: 'delete', store: 'docs', key: id })
      }
    }

    // A remapping pass first: an imported document may carry
    // the identifier of an existing document, and its parent must then point
    // at the new identifier, not at the old namesake.
    const remap = new Map<DocId, DocId>()
    for (const doc of data.docs) {
      remap.set(doc.id, mode === 'merge' && index.docs[doc.id] ? newId() : doc.id)
    }

    for (const doc of data.docs) {
      const id = remap.get(doc.id) as DocId
      const parentId = doc.parentId === null ? null : (remap.get(doc.parentId) ?? null)
      const { content, ...rest } = doc
      const summary: DocSummary = { ...rest, id, parentId }
      index = upsert(index, summary)
      writes.push({ op: 'put', store: 'docs', key: id, value: { ...summary, content } })
    }

    await this.#commit(index, writes)
    return data.docs.length
  }

  /** Destroys everything, then returns an inventory of what actually remains. */
  async wipe(): Promise<StorageSurvey> {
    this.#db.close()
    const remaining = await wipeEverything()
    this.#index = EMPTY_INDEX
    this.#emit()
    return remaining
  }

  survey(): Promise<StorageSurvey> {
    return surveyStorage()
  }

  close(): void {
    this.#db.close()
    this.#listeners.clear()
  }

  /**
   * Encrypts, writes in one transaction, and only then publishes the new index
   * in memory. If the write fails, the visible state stays the previous one —
   * the interface never shows a change that did not reach the disk.
   */
  async #commit(index: VaultIndex, writes: readonly BatchEntry[]): Promise<void> {
    const entries: BatchEntry[] = []
    for (const write of writes) {
      entries.push(
        write.op === 'delete'
          ? write
          : {
              ...write,
              value: await sealJson(this.#key, write.value as JsonValue, docContext(write.key)),
            },
      )
    }
    entries.push({
      op: 'put',
      store: 'index',
      key: INDEX_KEY,
      value: await sealJson(this.#key, index as unknown as JsonValue, indexContext()),
    })

    await writeBatch(this.#db, entries)
    this.#index = index
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}
