/**
 * Cycle de vie de la clé maîtresse.
 *
 * Toutes les données de l'utilisateur sont chiffrées avec une unique clé
 * maîtresse AES-GCM-256. Ce module décide comment cette clé est protégée au
 * repos, et rien d'autre.
 *
 * Une décision structurante : **la clé maîtresse n'est jamais extractible**.
 * Le navigateur la manipule sans jamais laisser JavaScript lire ses octets.
 * Le prix à payer est explicite — on ne peut pas la ré-enrober pour passer
 * d'un mode de protection à un autre. Changer de protection imposera donc de
 * générer une nouvelle clé et de rechiffrer les données (phase 4). Ce n'est
 * pas un contournement : faire tourner la clé quand la protection change est
 * exactement ce qu'on veut, puisque l'ancienne clé disparaît avec elle.
 *
 * Ce que le mode « device » protège, et ce qu'il ne protège pas :
 *   ✔ la copie brute du profil ou du disque — les enregistrements sont
 *     inexploitables sans la clé, qui n'existe nulle part sous forme lisible ;
 *   ✘ quelqu'un qui lance *votre* navigateur avec *votre* session — il obtient
 *     la même clé que vous. Seule une passphrase répond à cette menace.
 * L'interface doit dire les deux, sans arrondir.
 */

import { read, write, type StoreName } from '../storage/idb'

const META_STORE: StoreName = 'meta'

/** Enregistrement décrivant la protection du coffre. Lisible sans secret. */
const META_KEY = 'vault'

/** La `CryptoKey` non-extractible elle-même, en mode « device ». */
const DEVICE_KEY = 'deviceKey'

/**
 * La phase 4 ajoutera une variante `{ kind: 'passphrase'; kdf; wrappedKey }`.
 * L'union à une seule branche existe pour que cet ajout soit purement
 * additif, sans migration du format de `meta`.
 */
export type Protection = { readonly kind: 'device' }

export type VaultMeta = {
  readonly schema: 1
  readonly protection: Protection
  readonly createdAt: string
}

export class VaultError extends Error {
  override readonly name = 'VaultError'
}

export function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export function readVaultMeta(db: IDBDatabase): Promise<VaultMeta | undefined> {
  return read<VaultMeta>(db, META_STORE, META_KEY)
}

/**
 * Crée le coffre au tout premier lancement.
 *
 * Échoue si un coffre existe déjà : écraser la clé maîtresse rendrait toutes
 * les notes existantes définitivement illisibles, et c'est précisément le
 * genre d'accident qu'un appel involontaire pourrait provoquer.
 */
export async function createVault(db: IDBDatabase, now: Date = new Date()): Promise<CryptoKey> {
  if (await readVaultMeta(db)) {
    throw new VaultError('Un coffre existe déjà sur cet appareil.')
  }

  const key = await generateMasterKey()
  const meta: VaultMeta = {
    schema: 1,
    protection: { kind: 'device' },
    createdAt: now.toISOString(),
  }

  // La clé d'abord : si l'écriture de `meta` échoue, on se retrouve avec une
  // clé orpheline et aucun coffre — état détectable et réparable. L'ordre
  // inverse produirait un coffre déclaré mais sans clé, donc des données
  // futures non déchiffrables.
  await write(db, META_STORE, DEVICE_KEY, key)
  await write(db, META_STORE, META_KEY, meta)
  return key
}

/**
 * Ouvre un coffre existant. Renvoie `undefined` si aucun coffre n'existe
 * encore — l'appelant décide alors d'en créer un.
 */
export async function openVault(db: IDBDatabase): Promise<CryptoKey | undefined> {
  const meta = await readVaultMeta(db)
  if (!meta) return undefined

  if (meta.schema !== 1) {
    throw new VaultError(
      `Ce coffre a été créé par une version plus récente de Nook (schéma ${meta.schema}).`,
    )
  }

  const key = await read<CryptoKey>(db, META_STORE, DEVICE_KEY)
  if (!key) {
    throw new VaultError(
      'Le coffre est déclaré mais sa clé est introuvable. Les notes de cet appareil sont irrécupérables ; restaurez un export.',
    )
  }
  return key
}
