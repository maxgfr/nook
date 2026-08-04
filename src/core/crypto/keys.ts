/**
 * Lifecycle of the master key.
 *
 * All user data is encrypted with a single AES-GCM-256 master key. This
 * module decides how that key is protected at rest, and nothing else.
 *
 * One structural decision: **the master key is never extractable**. The
 * browser handles it without ever letting JavaScript read its bytes. The
 * price is explicit — it cannot be re-wrapped to move from one protection
 * mode to another. Changing protection will therefore mean generating a new
 * key and re-encrypting the data (phase 4). That is not a workaround:
 * rotating the key when protection changes is exactly what we want, since
 * the old key disappears with it.
 *
 * What "device" mode protects, and what it does not:
 *   ✔ a raw copy of the profile or the disk — the records are unusable
 *     without the key, which exists nowhere in readable form;
 *   ✘ someone who launches *your* browser with *your* session — they get
 *     the same key you do. Only a passphrase answers that threat.
 * The interface must say both, without rounding off.
 */

import { read, write, type StoreName } from '../storage/idb'

const META_STORE: StoreName = 'meta'

/** Record describing the vault's protection. Readable without the secret. */
const META_KEY = 'vault'

/** The non-extractable `CryptoKey` itself, in "device" mode. */
const DEVICE_KEY = 'deviceKey'

/**
 * Phase 4 will add a `{ kind: 'passphrase'; kdf; wrappedKey }` variant. The
 * single-branch union exists so that addition is purely additive, with no
 * migration of the `meta` format.
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
 * Creates the vault on the very first launch.
 *
 * Fails if a vault already exists: overwriting the master key would make
 * every existing note permanently unreadable, and that is precisely the kind
 * of accident an unintended call could cause.
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

  // The key first: if writing `meta` fails, we end up with an
  // orphan key and no vault — a detectable, repairable state. The reverse
  // reverse order would produce a vault that is declared but has no key, so
  // future data that cannot be decrypted.
  await write(db, META_STORE, DEVICE_KEY, key)
  await write(db, META_STORE, META_KEY, meta)
  return key
}

/**
 * Opens an existing vault. Returns `undefined` when no vault exists yet —
 * the caller then decides whether to create one.
 */
export async function openVault(db: IDBDatabase): Promise<CryptoKey | undefined> {
  const meta = await readVaultMeta(db)
  if (!meta) return undefined

  if (meta.schema !== 1) {
    throw new VaultError(
      `This vault was created by a newer version of Nook (schema ${meta.schema}).`,
    )
  }

  const key = await read<CryptoKey>(db, META_STORE, DEVICE_KEY)
  if (!key) {
    throw new VaultError(
      'The vault is declared but its key is missing. The notes on this device are unrecoverable; restore an export.',
    )
  }
  return key
}
