/**
 * Sharing a page with someone, without a server.
 *
 * There is nowhere to put a shared page, so a shared page is a **copy**. That
 * one fact decides everything else in this file, and it is stated here because
 * the interface is required to state it to the user:
 *
 * - **There is no revocation.** Nothing built here can reach a copy that has
 *   left. No function in this module is named `revoke`, because writing one
 *   would mean lying somewhere.
 * - **There is no expiry.** `notAfter` is carried and shown, and Nook's own
 *   reader will decline to render past it — but it is a request made of the
 *   reader, not a lock. Anyone holding the bytes and the passphrase can read
 *   them whenever they like, with this program or another one.
 * - **The passphrase is the only real protection**, and it is recommended
 *   rather than required. With one, a share is exactly as strong as the words
 *   chosen for it — the same Argon2id and the same AES-GCM that protect the
 *   vault. Without one it is not protected at all, and `kdf: null` says so in
 *   the payload so that both ends can tell the reader which they are holding.
 *   A *short* passphrase is the one thing refused outright: it looks like
 *   protection without being any, which is worse than choosing to send a page
 *   in the clear on purpose.
 *
 * The envelope's context is a constant rather than a record location. Everywhere
 * else, binding an envelope to `docs/<id>` is what stops an attacker moving one
 * record on top of another. A share has to open on a machine that has no such
 * record, so that property is deliberately given up here — and only here.
 */

import { fromBase64, fromBase64Url, toBase64, toBase64Url } from './base64'
import { openJson, sealJson, type Envelope } from './crypto/envelope'
import { checkPassphrase, defaultKdfParams, deriveWrappingKey, type KdfParams } from './crypto/kdf'
import type { JsonValue } from './model/types'

export const SHARE_FORMAT = 'nook-share'
export const SHARE_VERSION = 1

/** Where the reader's copy of Nook expects to find a shared page. */
export const SHARE_ROUTE = '#/read/'

/** The extension for a share too large to travel as a link. */
export const SHARE_FILE_EXTENSION = '.nookshare'

/**
 * A file, as it travels.
 *
 * Base64 rather than the `readonly number[]` the vault stores. Serialised as an
 * array of numbers a picture arrives at about four times its own size, before
 * encryption; as base64 it arrives at four thirds. This is the one place that
 * difference decides whether a share fits in a link at all.
 */
export type SharedFile = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly base64: string
}

export type SharedPage = {
  readonly title: string
  readonly content: JsonValue
  readonly files: readonly SharedFile[]
  readonly sharedAt: string
  /**
   * The date the sender asked that it not be read after.
   *
   * Carried, shown, and honoured by this program. Not enforced, and not
   * enforceable. The reader is told which of those two it is.
   */
  readonly notAfter?: string
  /** A line from the sender, shown above the page. */
  readonly note?: string
}

export type ShareKdf = {
  readonly algorithm: 'argon2id'
  readonly salt: string
  readonly memoryKiB: number
  readonly iterations: number
  readonly parallelism: number
}

/** What actually travels: the parameters needed to derive the key, and the box. */
export type SharePayload = {
  readonly format: typeof SHARE_FORMAT
  readonly version: typeof SHARE_VERSION
  /**
   * `null` when the share was made without a passphrase.
   *
   * The contents are then **in the clear** — base64 is an encoding, not a
   * lock, and anyone holding the link can read the page. That is a legitimate
   * choice for a shopping list and a bad one for anything else, so the shape
   * says which it is rather than leaving the reader to infer it, and the
   * interface is required to say so on both ends.
   */
  readonly kdf: ShareKdf | null
  readonly iv?: string
  readonly ct: string
}

/** Whether opening this share needs a passphrase at all. */
export function isSealed(payload: SharePayload): boolean {
  return payload.kdf !== null
}

export class ShareError extends Error {
  override readonly name = 'ShareError'
}

const CONTEXT = `share/v${SHARE_VERSION}`

/**
 * @param passphrase An empty string makes an **unencrypted** share: the page
 *   travels in the clear and anyone holding the link can read it. Anything
 *   else must pass `checkPassphrase`, because a short passphrase is worse than
 *   none — it looks like protection and is not.
 */
export async function packShare(page: SharedPage, passphrase: string): Promise<SharePayload> {
  if (passphrase === '') {
    return {
      format: SHARE_FORMAT,
      version: SHARE_VERSION,
      kdf: null,
      ct: toBase64(new TextEncoder().encode(JSON.stringify(page))),
    }
  }

  // Before the work, not after: refusing a four-character passphrase should
  // not cost a second of key derivation first.
  checkPassphrase(passphrase)

  // A fresh salt for every share. Two pages shared with the same words must not
  // produce the same key, or cracking one would crack the other.
  const kdf = defaultKdfParams()
  const key = await deriveWrappingKey(passphrase, kdf)
  const sealed = await sealJson(key, page as unknown as JsonValue, CONTEXT)

  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    kdf: {
      algorithm: 'argon2id',
      salt: toBase64(kdf.salt),
      memoryKiB: kdf.memoryKiB,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
    },
    iv: toBase64(sealed.iv),
    ct: toBase64(sealed.ct),
  }
}

export async function unpackShare(payload: SharePayload, passphrase: string): Promise<SharedPage> {
  if (payload?.format !== SHARE_FORMAT) {
    throw new ShareError('This is not a Nook share.')
  }
  if (payload.version !== SHARE_VERSION) {
    throw new ShareError(
      `This share was made by a different version of Nook (version ${String(payload.version)}).`,
    )
  }

  if (!isSealed(payload)) {
    // No key was ever involved, so there is nothing to check and no passphrase
    // to be wrong. Whoever made this chose to send a page in the clear.
    try {
      return JSON.parse(new TextDecoder().decode(bytesFrom(payload.ct, 'contents'))) as SharedPage
    } catch {
      throw new ShareError('This share is damaged and cannot be read.')
    }
  }

  const kdf = kdfFrom(payload)
  const key = await deriveWrappingKey(passphrase, kdf)
  const envelope: Envelope = {
    v: SHARE_VERSION,
    iv: bytesFrom(payload.iv ?? '', 'iv'),
    ct: bytesFrom(payload.ct, 'contents'),
  }

  // The decryption failure is left to say what it says. A wrong passphrase and
  // an altered payload are the same event to AES-GCM, and the interface is the
  // right place to guess which is likelier.
  return openJson<SharedPage>(key, envelope, CONTEXT)
}

function kdfFrom(payload: SharePayload): KdfParams {
  const { kdf } = payload
  if (kdf?.algorithm !== 'argon2id') {
    throw new ShareError('This share uses a key-derivation algorithm Nook does not know.')
  }
  return {
    algorithm: 'argon2id',
    salt: bytesFrom(kdf.salt, 'salt'),
    memoryKiB: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
  }
}

function bytesFrom(text: string, what: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || text === '') {
    throw new ShareError(`This share is missing its ${what}.`)
  }
  try {
    return fromBase64(text)
  } catch {
    throw new ShareError(`This share's ${what} is damaged.`)
  }
}

/** The text that travels: a link fragment, or the contents of a file. */
export function encodeShare(payload: SharePayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

export function decodeShare(text: string): SharePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(text.trim())))
  } catch {
    throw new ShareError('This does not look like a Nook share — it may have been truncated.')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ShareError('This does not look like a Nook share.')
  }
  return parsed as SharePayload
}

/**
 * How large a share may be and still go as a link.
 *
 * Not a browser limit — Chrome would take far more. It is the carriers: mail
 * servers and chat clients wrap, shorten and truncate long links, and a
 * truncated share fails at the far end with nothing to say why. Past this, the
 * interface offers a file instead and explains itself.
 */
export const LINK_LIMIT_BYTES = 256 * 1024

export function fitsInLink(encoded: string): boolean {
  return encoded.length <= LINK_LIMIT_BYTES
}

/** Whether the sender's requested date has gone by. */
export function isPastNotAfter(page: SharedPage, now: Date = new Date()): boolean {
  if (!page.notAfter) return false
  const deadline = new Date(page.notAfter)
  return !Number.isNaN(deadline.getTime()) && now.getTime() > deadline.getTime()
}
