/**
 * Lifecycle of the master key.
 *
 * All user data is encrypted with a single AES-GCM-256 master key. This module
 * decides how that key is protected at rest, and nothing else.
 *
 * Two modes, and the difference between them is the whole security story:
 *
 * - **device** — the key is a `CryptoKey` the browser holds and JavaScript can
 *   never read. It protects a raw copy of the profile or the disk. It does not
 *   protect against someone opening *your* browser with *your* session: they
 *   get the same key you do.
 *
 * - **passphrase** — the key exists on disk only wrapped by a key derived from
 *   a secret nobody but you has. Nothing is readable without it, including by
 *   you if you forget it. There is no recovery, because there is no server to
 *   recover from.
 *
 * Switching between modes **rotates the key and re-encrypts everything**. That
 * is not a workaround for a non-extractable key: it is the behaviour we want.
 * Changing how a vault is protected should retire the old key, so a copy taken
 * before the change cannot be opened with what you know after it.
 */

import { open, randomBytes, seal, type Bytes, type Envelope } from './envelope'
import { checkPassphrase, deriveWrappingKey, PassphraseError, type KdfParams } from './kdf'
import { read, write, writeBatch, type StoreName } from '../storage/idb'

const META_STORE: StoreName = 'meta'

/** Record describing the vault's protection. Readable without the secret. */
const META_KEY = 'vault'

/** The non-extractable `CryptoKey` itself, in "device" mode. */
const DEVICE_KEY = 'deviceKey'

/** Where the wrapped master key is bound, in "passphrase" mode. */
const MASTER_CONTEXT = 'meta/masterKey'

export type Protection =
  | { readonly kind: 'device' }
  | { readonly kind: 'passphrase'; readonly kdf: KdfParams; readonly wrapped: Envelope }

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

/** Raw key material, for the one mode that has to wrap it. */
export function generateMasterMaterial(): Bytes {
  return randomBytes(32)
}

export function importMasterKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function readVaultMeta(db: IDBDatabase): Promise<VaultMeta | undefined> {
  return read<VaultMeta>(db, META_STORE, META_KEY)
}

function checkSchema(meta: VaultMeta): void {
  if (meta.schema !== 1) {
    throw new VaultError(
      `This vault was created by a newer version of Nook (schema ${meta.schema}).`,
    )
  }
}

/**
 * Creates the vault on the very first launch, in device mode.
 *
 * Fails if a vault already exists: overwriting the master key would make every
 * existing note permanently unreadable, and that is precisely the kind of
 * accident an unintended call could cause.
 */
export async function createVault(db: IDBDatabase, now: Date = new Date()): Promise<CryptoKey> {
  if (await readVaultMeta(db)) {
    throw new VaultError('A vault already exists on this device.')
  }

  const key = await generateMasterKey()
  const meta: VaultMeta = {
    schema: 1,
    protection: { kind: 'device' },
    createdAt: now.toISOString(),
  }

  // The key first: if writing `meta` fails, we end up with an orphan key and no
  // vault — a detectable, repairable state. The reverse order would produce a
  // vault that is declared but has no key, so future data that cannot be
  // decrypted.
  await write(db, META_STORE, DEVICE_KEY, key)
  await write(db, META_STORE, META_KEY, meta)
  return key
}

/**
 * Opens a device-mode vault. Returns `undefined` when no vault exists yet.
 *
 * Refuses a passphrase-protected vault rather than pretending: the caller must
 * ask for the secret and go through `unlockVault`.
 */
export async function openVault(db: IDBDatabase): Promise<CryptoKey | undefined> {
  const meta = await readVaultMeta(db)
  if (!meta) return undefined
  checkSchema(meta)

  if (meta.protection.kind === 'passphrase') {
    throw new VaultError('This vault is protected by a passphrase.')
  }

  const key = await read<CryptoKey>(db, META_STORE, DEVICE_KEY)
  if (!key) {
    throw new VaultError(
      'The vault is declared but its key is missing. The notes on this device are unrecoverable; restore an export.',
    )
  }
  return key
}

/** Opens a passphrase-protected vault. */
export async function unlockVault(db: IDBDatabase, passphrase: string): Promise<CryptoKey> {
  const meta = await readVaultMeta(db)
  if (!meta) throw new VaultError('There is no vault on this device.')
  checkSchema(meta)
  if (meta.protection.kind !== 'passphrase') {
    throw new VaultError('This vault is not protected by a passphrase.')
  }

  const wrappingKey = await deriveWrappingKey(passphrase, meta.protection.kdf)
  let raw: Bytes
  try {
    raw = await open(wrappingKey, meta.protection.wrapped, MASTER_CONTEXT)
  } catch {
    // A wrong passphrase and a corrupted record are indistinguishable to
    // AES-GCM. Since the overwhelmingly likely cause is a typo, the message
    // says the useful thing rather than the exhaustive one.
    throw new PassphraseError('Wrong passphrase.')
  }

  try {
    return await importMasterKey(raw)
  } finally {
    raw.fill(0)
  }
}

/**
 * Replaces the vault's protection, atomically.
 *
 * The caller has already re-encrypted the data with the new key; this writes
 * the new protection record and removes whatever the old mode left behind.
 * Doing both in one transaction is what stops a vault from ending up declaring
 * a passphrase while still holding — and trusting — the old device key.
 */
export async function replaceProtection(
  db: IDBDatabase,
  meta: VaultMeta,
  options: { readonly deviceKey?: CryptoKey } = {},
): Promise<void> {
  await writeBatch(db, [
    options.deviceKey
      ? { op: 'put', store: META_STORE, key: DEVICE_KEY, value: options.deviceKey }
      : { op: 'delete', store: META_STORE, key: DEVICE_KEY },
    { op: 'put', store: META_STORE, key: META_KEY, value: meta },
  ])
}

/** Builds the protection record for a passphrase, wrapping the given material. */
export async function passphraseProtection(
  passphrase: string,
  masterMaterial: Bytes,
  kdf: KdfParams,
): Promise<Protection> {
  checkPassphrase(passphrase)
  const wrappingKey = await deriveWrappingKey(passphrase, kdf)
  return {
    kind: 'passphrase',
    kdf,
    wrapped: await seal(wrappingKey, masterMaterial, MASTER_CONTEXT),
  }
}
