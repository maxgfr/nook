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
import {
  createVault,
  generateMasterKey,
  generateMasterMaterial,
  importMasterKey,
  openVault,
  passphraseProtection,
  readVaultMeta,
  replaceProtection,
  unlockVault,
  type Protection,
  type VaultMeta,
} from './crypto/keys'
import { defaultKdfParams } from './crypto/kdf'
import {
  listKeys,
  openDatabase,
  read,
  requestPersistentStorage,
  writeBatch,
  type BatchEntry,
} from './storage/idb'
import { surveyStorage, wipeEverything, type StorageSurvey } from './storage/wipe'
import { fromBase64, toBase64 } from './base64'
import { referencedBlobIds } from './model/blobs'
import type { SharedFile } from './share'
import { buildFacets, type DocFacets } from './model/facets'
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
  INDEX_SCHEMA,
  newId,
  nextHistory,
  snapshotNow,
  UNTITLED,
  type Doc,
  type DocId,
  type DocSummary,
  type JsonValue,
  type Snapshot,
  type SnapshotMode,
  type VaultIndex,
} from './model/types'

const INDEX_KEY = 'index'
const indexContext = () => `index/${INDEX_KEY}`
const docContext = (id: DocId) => `docs/${id}`
const blobContext = (id: string) => `blobs/${id}`

/**
 * A file kept in the vault.
 *
 * Bytes travel as a plain array because that is what survives being encrypted,
 * stored and exported without a second representation to keep in step.
 */
export type StoredBlob = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly bytes: readonly number[]
}

/** Content of a fresh document: an empty paragraph, ready for the caret. */
const EMPTY_CONTENT: JsonValue = []

export type VaultExport = {
  readonly format: 'nook-export'
  readonly version: 1
  readonly exportedAt: string
  readonly docs: readonly Doc[]
  /** Absent in exports written before files were supported. */
  readonly blobs?: readonly StoredBlob[]
}

/**
 * `replace` erases the vault before importing; `merge` keeps what is there and
 * reassigns an identifier to documents that would collide. There is no default
 * mode: overwriting notes must always be an explicit choice.
 */
export type ImportMode = 'replace' | 'merge'

/**
 * What may actually be sitting on disk. A vault created before schema 2 has no
 * facets; `Vault.open` upgrades it by reading every document once.
 */
type LegacyDocs = Readonly<Record<DocId, DocSummary>>
type StoredIndex =
  | VaultIndex
  | { readonly schema: 1; readonly docs: LegacyDocs }
  | { readonly schema: 2; readonly docs: LegacyDocs; readonly facets: VaultIndex['facets'] }

/**
 * Presents an older index in the current shape.
 *
 * Missing pieces get their empty value rather than a guess: facets are then
 * rebuilt from the documents, and an unplaced page simply falls back to the
 * automatic layout.
 */
function upgraded(stored: StoredIndex): VaultIndex {
  if (stored.schema === INDEX_SCHEMA) return stored
  return {
    schema: INDEX_SCHEMA,
    docs: stored.docs,
    facets: stored.schema === 2 ? stored.facets : {},
    positions: {},
  }
}

function contextFor(store: string, key: string): string {
  return store === 'blobs' ? blobContext(key) : docContext(key)
}

function withFacets(index: VaultIndex, id: DocId, facets: DocFacets): VaultIndex {
  return { ...index, facets: { ...index.facets, [id]: facets } }
}

function withoutFacets(index: VaultIndex, ids: readonly DocId[]): VaultIndex {
  const facets = { ...index.facets }
  const positions = { ...index.positions }
  for (const id of ids) {
    delete facets[id]
    delete positions[id]
  }
  return { ...index, facets, positions }
}

export class Vault {
  // Fields declared then assigned rather than constructor properties:
  // `erasableSyntaxOnly` forbids the latter, because they produce
  // code at runtime and therefore cannot simply be erased by a transpiler
  // transpiler that only strips types.
  readonly #db: IDBDatabase
  #key: CryptoKey
  #meta: VaultMeta
  #index: VaultIndex
  readonly #listeners = new Set<() => void>()

  private constructor(db: IDBDatabase, key: CryptoKey, meta: VaultMeta, index: VaultIndex) {
    this.#db = db
    this.#key = key
    this.#meta = meta
    this.#index = index
  }

  /**
   * Says how this device's vault is protected, without opening it.
   *
   * The interface needs this before it can decide what to show: a passphrase
   * vault must ask for the secret, and there is nothing to ask when no vault
   * exists yet.
   */
  static async inspect(databaseName?: string): Promise<Protection | null> {
    const db = await openDatabase(databaseName)
    try {
      return (await readVaultMeta(db))?.protection ?? null
    } finally {
      db.close()
    }
  }

  static async unlock(passphrase: string, databaseName?: string): Promise<Vault> {
    const db = await openDatabase(databaseName)
    const key = await unlockVault(db, passphrase)
    return Vault.#load(db, key)
  }

  get protection(): Protection {
    return this.#meta.protection
  }

  /** Opens this device's vault, or creates it on the very first launch. */
  static async open(databaseName?: string): Promise<Vault> {
    // Requested as soon as we open, before any write: a refusal blocks nothing,
    // it only makes the notes evictable after a long spell of inactivity.
    void requestPersistentStorage()

    const db = await openDatabase(databaseName)
    const key = (await openVault(db)) ?? (await createVault(db))
    return Vault.#load(db, key)
  }

  static async #load(db: IDBDatabase, key: CryptoKey): Promise<Vault> {
    const meta = await readVaultMeta(db)
    if (!meta) throw new Error('The vault record disappeared while opening.')

    const stored = await read<Envelope>(db, 'index', INDEX_KEY)
    const onDisk = stored ? await openJson<StoredIndex>(key, stored, indexContext()) : EMPTY_INDEX

    const vault = new Vault(db, key, meta, upgraded(onDisk))
    // Facets are derived data, so an older vault is repaired by recomputing
    // them rather than by a migration that could get them wrong.
    if (onDisk.schema !== INDEX_SCHEMA) await vault.#rebuildFacets()
    return vault
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

    const next = withFacets(
      upsert(this.#index, summary),
      summary.id,
      buildFacets(summary.title, EMPTY_CONTENT),
    )
    await this.#commit(next, [
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
    /**
     * How this save should treat the history. Defaults to the automatic rule
     * at its default interval; the interface passes whatever the reader chose
     * in Settings, and `restore` forces a snapshot — see `nextHistory`.
     */
    options: { snapshot?: SnapshotMode; intervalMs?: number } = {},
  ): Promise<DocSummary> {
    const current = await this.readDoc(id)
    const now = new Date()
    // Only a content change is worth remembering; renaming a page is not the
    // kind of edit anyone needs to undo from a list of timestamps.
    const contentChanged =
      patch.content !== undefined &&
      JSON.stringify(patch.content) !== JSON.stringify(current.content)

    const updated: Doc = {
      ...current,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
      ...(patch.content === undefined ? {} : { content: patch.content }),
      ...(contentChanged
        ? {
            history: nextHistory(current.history, current.content, now, {
              ...(options.snapshot === undefined ? {} : { mode: options.snapshot }),
              ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
            }),
          }
        : {}),
      updatedAt: now.toISOString(),
    }

    const { content: _content, history: _history, ...summary } = updated
    const next = withFacets(
      upsert(this.#index, summary),
      id,
      buildFacets(updated.title, updated.content),
    )
    await this.#commit(next, [{ op: 'put', store: 'docs', key: id, value: updated }])
    return summary
  }

  /** Past states of a document, most recent first. */
  async history(id: DocId): Promise<readonly Snapshot[]> {
    return (await this.readDoc(id)).history ?? []
  }

  /**
   * Keeps the page as it stands right now, because someone asked.
   *
   * The automatic rule can only ever be a guess about which moments matter.
   * This is the answer to that: the one moment somebody actually chose. It
   * ignores the interval entirely — waiting out a clock is not a thing to ask
   * of someone who has just decided this version is worth keeping.
   *
   * Returns `false` when nothing has changed since the newest snapshot, so
   * pressing twice does not spend two of the twenty slots on the same text.
   */
  async snapshot(id: DocId): Promise<boolean> {
    const doc = await this.readDoc(id)
    const now = new Date()
    const history = snapshotNow(doc.history, doc.content, now)
    if (!history) return false

    /*
     * The summary is rewritten too, and it has to be.
     *
     * Keeping a version really does change the stored document, so `updatedAt`
     * moves with it — and that is also the signal the interface watches. A
     * commit that wrote the document but left the index untouched would put a
     * snapshot on disk that nothing on screen could see until the next reload,
     * which is precisely the defect this feature was added to answer.
     *
     * The facets are not recomputed: the content is unchanged, so what the
     * page says and what it links to are unchanged.
     */
    const updated: Doc = { ...doc, history, updatedAt: now.toISOString() }
    const { content: _content, history: _history, ...summary } = updated

    await this.#commit(upsert(this.#index, summary), [
      { op: 'put', store: 'docs', key: id, value: updated },
    ])
    return true
  }

  /**
   * Puts a past state back.
   *
   * Restoring is an ordinary edit, so the state being replaced is itself
   * snapshotted: changing your mind about changing your mind must also work.
   */
  async restore(id: DocId, at: string): Promise<void> {
    const doc = await this.readDoc(id)
    const snapshot = doc.history?.find((candidate) => candidate.at === at)
    if (!snapshot) throw new Error('That version is no longer available.')
    await this.saveDoc(id, { content: snapshot.content }, { snapshot: 'always' })
  }

  /** Remembers where a page was dragged to on the canvas. */
  async placeOnCanvas(id: DocId, point: { x: number; y: number }): Promise<void> {
    docOrThrow(this.#index, id)
    await this.#commit({ ...this.#index, positions: { ...this.#index.positions, [id]: point } }, [])
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
      withoutFacets(removeAll(this.#index, removed), removed),
      removed.map((docId) => ({ op: 'delete', store: 'docs', key: docId }) as const),
    )
    return removed
  }

  /**
   * Stores a file, encrypted like everything else.
   *
   * Images live in the vault rather than on a server, so a note with a picture
   * in it is as private as a note without one. The cost is that the file is in
   * the export and in the backup, which is the correct trade for a notebook
   * that promises nothing leaves the machine.
   */
  async putBlob(file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
    const id = newId()
    const record: StoredBlob = {
      id,
      name: file.name,
      type: file.type,
      bytes: [...file.bytes],
    }
    await writeBatch(this.#db, [
      {
        op: 'put',
        store: 'blobs',
        key: id,
        value: await sealJson(this.#key, record as unknown as JsonValue, blobContext(id)),
      },
    ])
    return id
  }

  async readBlob(id: string): Promise<StoredBlob | undefined> {
    const stored = await read<Envelope>(this.#db, 'blobs', id)
    if (!stored) return undefined
    return openJson<StoredBlob>(this.#key, stored, blobContext(id))
  }

  /**
   * Gathers what a page needs to be readable somewhere else.
   *
   * **The history does not go.** `readDoc` returns every past state of the
   * document, and a page shared with its history would hand the recipient every
   * draft, every sentence written and deleted, and every earlier version of
   * anything that was corrected. Nobody sharing a page means to share that. Only
   * the title, the current content and the files it points at are taken.
   *
   * Files are looked up from the content rather than from the whole store, so a
   * share carries the pictures on that page and no others.
   */
  async buildShare(id: DocId): Promise<{
    title: string
    content: JsonValue
    files: SharedFile[]
  }> {
    const doc = await this.readDoc(id)
    const files: SharedFile[] = []

    for (const blobId of referencedBlobIds(doc.content)) {
      const blob = await this.readBlob(blobId)
      if (!blob) continue
      files.push({
        id: blob.id,
        name: blob.name,
        type: blob.type,
        base64: toBase64(Uint8Array.from(blob.bytes)),
      })
    }

    return { title: doc.title, content: doc.content, files }
  }

  /**
   * Takes a page someone shared and makes it one of yours.
   *
   * It arrives at the top level with a fresh identifier and no history: it is a
   * new page in this notebook, not a continuation of the sender's. The files
   * keep the identifiers they had, exactly as an import does — the content
   * refers to them by those names, and they are drawn from the same space of
   * random identifiers as everything else.
   */
  async adoptShare(page: {
    title: string
    content: JsonValue
    files: readonly SharedFile[]
  }): Promise<DocSummary> {
    const now = new Date().toISOString()
    const summary: DocSummary = {
      id: newId(),
      parentId: null,
      title: page.title,
      icon: null,
      createdAt: now,
      updatedAt: now,
      order: nextOrder(this.#index, null),
    }

    const writes: BatchEntry[] = [
      { op: 'put', store: 'docs', key: summary.id, value: { ...summary, content: page.content } },
    ]
    for (const file of page.files) {
      const record: StoredBlob = {
        id: file.id,
        name: file.name,
        type: file.type,
        bytes: [...fromBase64(file.base64)],
      }
      writes.push({ op: 'put', store: 'blobs', key: file.id, value: record })
    }

    await this.#commit(
      withFacets(upsert(this.#index, summary), summary.id, buildFacets(page.title, page.content)),
      writes,
    )
    return summary
  }

  async exportAll(): Promise<VaultExport> {
    const docs = await Promise.all(Object.keys(this.#index.docs).map((id) => this.readDoc(id)))
    // Files are exported too. An export that silently dropped the images would
    // look complete and restore a notebook full of holes.
    const ids = await listKeys(this.#db, 'blobs')
    const blobs = (await Promise.all(ids.map((id) => this.readBlob(id)))).filter(
      (blob): blob is StoredBlob => blob !== undefined,
    )

    return {
      format: 'nook-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      docs,
      blobs,
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
      index = withFacets(upsert(index, summary), id, buildFacets(summary.title, content))
      writes.push({ op: 'put', store: 'docs', key: id, value: { ...summary, content } })
    }

    for (const blob of data.blobs ?? []) {
      // Passed unsealed: `#commit` encrypts every entry it is given, binding
      // each to its own store. Sealing here as well produced an envelope
      // wrapped twice, the outer one bound to the wrong place.
      writes.push({ op: 'put', store: 'blobs', key: blob.id, value: blob })
    }

    await this.#commit(index, writes)
    return data.docs.length
  }

  /**
   * Puts the vault behind a passphrase.
   *
   * Everything is re-encrypted under a brand-new key, so the key that was
   * usable without a secret stops being able to open anything. A backup taken
   * before this call cannot be read with the passphrase, and vice versa —
   * which is the point.
   */
  async enablePassphrase(passphrase: string): Promise<void> {
    if (this.#meta.protection.kind === 'passphrase') {
      throw new Error('This vault is already protected by a passphrase.')
    }

    const material = generateMasterMaterial()
    try {
      const protection = await passphraseProtection(passphrase, material, defaultKdfParams())
      await this.#rotate(await importMasterKey(material), protection)
    } finally {
      material.fill(0)
    }
  }

  /** Goes back to device protection, rotating the key just the same. */
  async disablePassphrase(): Promise<void> {
    if (this.#meta.protection.kind !== 'passphrase') {
      throw new Error('This vault is not protected by a passphrase.')
    }
    const deviceKey = await generateMasterKey()
    await this.#rotate(deviceKey, { kind: 'device' }, deviceKey)
  }

  /**
   * Re-encrypts the whole vault under `nextKey` and swaps the protection.
   *
   * Every record and the protection itself are written in a single
   * transaction. Splitting them would allow a state where the data is
   * encrypted with a key the vault record does not describe — that is, notes
   * nobody can ever open again.
   */
  async #rotate(nextKey: CryptoKey, protection: Protection, deviceKey?: CryptoKey): Promise<void> {
    const entries: BatchEntry[] = []
    for (const id of Object.keys(this.#index.docs)) {
      const doc = await this.readDoc(id)
      entries.push({
        op: 'put',
        store: 'docs',
        key: id,
        value: await sealJson(nextKey, doc as unknown as JsonValue, docContext(id)),
      })
    }
    // Files are encrypted with the same key, so they rotate with everything
    // else. Leaving them behind would produce a vault whose notes open and
    // whose pictures do not.
    for (const id of await listKeys(this.#db, 'blobs')) {
      const blob = await this.readBlob(id)
      if (!blob) continue
      entries.push({
        op: 'put',
        store: 'blobs',
        key: id,
        value: await sealJson(nextKey, blob as unknown as JsonValue, blobContext(id)),
      })
    }

    entries.push({
      op: 'put',
      store: 'index',
      key: INDEX_KEY,
      value: await sealJson(nextKey, this.#index as unknown as JsonValue, indexContext()),
    })

    const meta: VaultMeta = { ...this.#meta, protection }
    await writeBatch(this.#db, entries)
    await replaceProtection(this.#db, meta, deviceKey ? { deviceKey } : {})

    this.#key = nextKey
    this.#meta = meta
    this.#emit()
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
              value: await sealJson(
                this.#key,
                write.value as JsonValue,
                // Each record is bound to its own store. Using one context for
                // everything would let a file be read as a document, which is
                // exactly what binding an envelope to its location prevents.
                contextFor(write.store, write.key),
              ),
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

  /**
   * Recomputes every document's facets, and stores them.
   *
   * Runs once, when a vault written before facets existed is opened. It is the
   * only operation that decrypts the whole notebook — acceptable for a one-off
   * upgrade, and it keeps the derived data honest instead of migrating a shape
   * we would have to guess at.
   */
  async #rebuildFacets(): Promise<void> {
    let index = this.#index
    for (const id of Object.keys(index.docs)) {
      try {
        const doc = await this.readDoc(id)
        index = withFacets(index, id, buildFacets(doc.title, doc.content))
      } catch {
        // A document whose content is missing keeps empty facets rather than
        // aborting the upgrade: the rest of the notebook stays searchable.
      }
    }
    await this.#commit(index, [])
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}
