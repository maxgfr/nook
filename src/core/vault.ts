/**
 * Le coffre — la seule API que l'interface consomme.
 *
 * Tout ce qui est en dessous (IndexedDB, AES-GCM, l'arbre, les migrations)
 * est un détail que `src/ui` n'a pas le droit de connaître. Un test le fait
 * respecter : voir `core/architecture.test.ts`.
 *
 * Deux garanties tenues ici, et nulle part ailleurs :
 *
 * 1. **L'index et les documents ne divergent jamais.** Chaque mutation
 *    chiffre ce qu'elle doit écrire, *puis* écrit le document et l'index dans
 *    une seule transaction. Une coupure au mauvais moment laisse l'état
 *    d'avant, jamais un index qui référence un document absent.
 *
 * 2. **L'index vit en mémoire, déchiffré une seule fois.** La barre latérale,
 *    la palette et les fils d'Ariane n'ont donc jamais à déchiffrer un
 *    document pour s'afficher.
 */

import { openJson, sealJson, type Envelope } from './crypto/envelope'
import { createVault, openVault } from './crypto/keys'
import { openDatabase, read, writeBatch, type BatchEntry } from './storage/idb'
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

/** Contenu d'un document neuf : un paragraphe vide, prêt à recevoir le curseur. */
const EMPTY_CONTENT: JsonValue = []

export type VaultExport = {
  readonly format: 'nook-export'
  readonly version: 1
  readonly exportedAt: string
  readonly docs: readonly Doc[]
}

/**
 * `replace` efface le coffre avant d'importer ; `merge` conserve l'existant et
 * réattribue un identifiant aux documents qui entreraient en collision. Aucun
 * mode par défaut : écraser des notes doit toujours être un choix explicite.
 */
export type ImportMode = 'replace' | 'merge'

export class Vault {
  // Champs déclarés puis affectés plutôt que des propriétés de constructeur :
  // `erasableSyntaxOnly` interdit ces dernières, parce qu'elles produisent du
  // code à l'exécution et ne peuvent donc pas être simplement effacées par un
  // transpileur qui ne fait que retirer les types.
  readonly #db: IDBDatabase
  readonly #key: CryptoKey
  #index: VaultIndex
  readonly #listeners = new Set<() => void>()

  private constructor(db: IDBDatabase, key: CryptoKey, index: VaultIndex) {
    this.#db = db
    this.#key = key
    this.#index = index
  }

  /** Ouvre le coffre de cet appareil, ou le crée au tout premier lancement. */
  static async open(databaseName?: string): Promise<Vault> {
    const db = await openDatabase(databaseName)
    const key = (await openVault(db)) ?? (await createVault(db))

    const stored = await read<Envelope>(db, 'index', INDEX_KEY)
    const index = stored ? await openJson<VaultIndex>(key, stored, indexContext()) : EMPTY_INDEX

    return new Vault(db, key, index)
  }

  get index(): VaultIndex {
    return this.#index
  }

  /** Prévient l'interface qu'il faut se redessiner. Renvoie la désinscription. */
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
      throw new Error(`Le contenu du document « ${summary.title || UNTITLED} » est introuvable.`)
    }
    const doc = await openJson<Doc>(this.#key, stored, docContext(id))
    // L'index fait autorité sur les métadonnées : c'est lui que les
    // déplacements et renommages mettent à jour.
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
   * Supprime un document et toute sa descendance. Sans la cascade, les pages
   * filles resteraient dans la base en référençant un parent disparu, donc
   * invisibles et jamais récupérables.
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
      throw new Error('Ce fichier n’est pas un export Nook lisible par cette version.')
    }

    let index = mode === 'replace' ? EMPTY_INDEX : this.#index
    const writes: BatchEntry[] = []

    if (mode === 'replace') {
      for (const id of Object.keys(this.#index.docs)) {
        writes.push({ op: 'delete', store: 'docs', key: id })
      }
    }

    // Une passe de remappage d'abord : un document importé peut porter
    // l'identifiant d'un document existant, et son parent doit alors pointer
    // vers le nouvel identifiant, pas vers l'ancien homonyme.
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

  /** Détruit tout, puis renvoie l'inventaire de ce qui subsiste réellement. */
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
   * Chiffre, écrit en une transaction, puis seulement alors publie le nouvel
   * index en mémoire. Si l'écriture échoue, l'état visible reste celui d'avant
   * — l'interface ne montre jamais une modification qui n'a pas atteint le
   * disque.
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
