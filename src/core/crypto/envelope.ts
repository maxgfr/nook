/**
 * Sealed envelope — Nook's unit of storage.
 *
 * Everything written to disk goes through here. Nothing else in the project
 * calls `crypto.subtle` to encrypt user data.
 *
 * The choice worth explaining is `context`. On top of the content, AES-GCM
 * authenticates an associated datum that is not encrypted. We put the
 * record's location in it. The consequence: an attacker with disk access
 * cannot *relocate* an envelope — copying the contents of `docs/A` into
 * `docs/B` produces an authentication failure instead of a silent
 * substitution. Without it, encryption would protect confidentiality but not
 * the integrity of the structure.
 */

export const ENVELOPE_VERSION = 1

/** AES-GCM requires a 96-bit nonce; it is also the only recommended size. */
const IV_LENGTH = 12

/**
 * A view over an ordinary `ArrayBuffer`.
 *
 * `Uint8Array` has been generic over its buffer since TypeScript 5.7, in
 * order to distinguish memory shared between threads (`SharedArrayBuffer`) —
 * which WebCrypto refuses. The alias avoids repeating that on every
 * signature, and makes any attempt to encrypt a shared buffer fail to
 * compile.
 */
export type Bytes = Uint8Array<ArrayBuffer>

export type Envelope = {
  readonly v: number
  readonly iv: Bytes
  readonly ct: Bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class DecryptionError extends Error {
  override readonly name = 'DecryptionError'
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Envelope>
  return (
    typeof candidate.v === 'number' &&
    candidate.iv instanceof Uint8Array &&
    candidate.ct instanceof Uint8Array
  )
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * Binds the envelope to its location. The version is part of the
 * authenticated data: a future format change cannot be passed off as a
 * record of the old one.
 */
function associatedData(context: string): Bytes {
  return encoder.encode(`nook/v${ENVELOPE_VERSION}/${context}`)
}

/**
 * @param context Location of the record, for example `docs/<id>`.
 *   The same value will have to be supplied when decrypting.
 */
export async function seal(key: CryptoKey, plaintext: Bytes, context: string): Promise<Envelope> {
  // A random nonce on every write. AES-GCM tolerates roughly 2³² encryptions
  // per key with 96-bit nonces drawn at random; a notebook will never
  // come anywhere near that order of magnitude.
  const iv = randomBytes(IV_LENGTH)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(context) },
    key,
    plaintext,
  )
  return { v: ENVELOPE_VERSION, iv, ct: new Uint8Array(ct) }
}

export async function open(key: CryptoKey, envelope: Envelope, context: string): Promise<Bytes> {
  if (!isEnvelope(envelope)) {
    throw new DecryptionError('Unreadable record: this is not a Nook envelope.')
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new DecryptionError(
      `Envelope in version ${envelope.v}, incompatible with this version of Nook (${ENVELOPE_VERSION}).`,
    )
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv, additionalData: associatedData(context) },
      key,
      envelope.ct,
    )
    return new Uint8Array(plaintext)
  } catch (cause) {
    // AES-GCM does not distinguish "wrong key" from "altered data" from
    // "relocated envelope": in all three cases, verifying the tag
    // fails. The message therefore stays deliberately broad.
    throw new DecryptionError('Cannot decrypt: wrong key, altered data, or a relocated record.', {
      cause,
    })
  }
}

export async function sealJson(key: CryptoKey, value: unknown, context: string): Promise<Envelope> {
  return seal(key, encoder.encode(JSON.stringify(value)), context)
}

export async function openJson<T>(key: CryptoKey, envelope: Envelope, context: string): Promise<T> {
  const bytes = await open(key, envelope, context)
  try {
    return JSON.parse(decoder.decode(bytes)) as T
  } catch (cause) {
    // The GCM tag was verified: the content really is ours. Invalid JSON here
    // here signals a serialisation bug, not an attack.
    throw new DecryptionError('Decrypted, but unreadable: invalid JSON.', { cause })
  }
}
