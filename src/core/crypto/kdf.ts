/**
 * Turning a passphrase into a key.
 *
 * A passphrase is short and guessable; a key must not be. Argon2id is what
 * stands between the two: it makes each guess cost measurable time *and*
 * memory, which is what defeats the GPU farms that make plain hashing useless
 * here.
 *
 * The parameters are stored next to the wrapped key rather than hard-coded at
 * the reading end. A vault created today must still open in five years, after
 * we have raised the cost for new vaults — so the numbers travel with the data.
 *
 * The WebAssembly implementation is bundled, never fetched. A key-derivation
 * routine downloaded at unlock time would be the single most attractive thing
 * on the page to tamper with, and the product forbids network access anyway.
 */

import { argon2id } from 'hash-wasm'
import { randomBytes, type Bytes } from './envelope'

export type KdfParams = {
  readonly algorithm: 'argon2id'
  /** Unique per vault, so two identical passphrases derive different keys. */
  readonly salt: Bytes
  readonly memoryKiB: number
  readonly iterations: number
  readonly parallelism: number
}

/**
 * OWASP's recommended Argon2id settings: 19 MiB of memory, two passes, no
 * parallelism. On a laptop this takes a few tenths of a second — slow enough
 * to matter at scale, fast enough that unlocking does not feel broken.
 */
export function defaultKdfParams(): KdfParams {
  return {
    algorithm: 'argon2id',
    salt: randomBytes(16),
    memoryKiB: 19_456,
    iterations: 2,
    parallelism: 1,
  }
}

export class PassphraseError extends Error {
  override readonly name = 'PassphraseError'
}

/**
 * Derives the key that wraps the master key.
 *
 * The result is imported as non-extractable, like every other key here: even
 * the code that just derived it cannot read its bytes back.
 */
export async function deriveWrappingKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  if (params.algorithm !== 'argon2id') {
    throw new PassphraseError(
      `This vault uses an unknown key-derivation algorithm (${String(params.algorithm)}).`,
    )
  }

  const derived = await argon2id({
    password: passphrase,
    salt: params.salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  })

  // Copied into a view over a plain `ArrayBuffer`: hash-wasm returns a generic
  // `Uint8Array`, and WebCrypto refuses anything that might be backed by
  // shared memory.
  const raw: Bytes = new Uint8Array(derived)

  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ])
  } finally {
    // The derived bytes have no reason to linger in buffers the garbage
    // collector may keep around. Zeroing is cheap; leaving them is careless.
    raw.fill(0)
    derived.fill(0)
  }
}

/**
 * Rejects passphrases short enough to be brute-forced despite Argon2id.
 *
 * A deliberately blunt rule — length only. Composition rules ("one digit, one
 * symbol") push people towards `Password1!`, which is worse than a long
 * sentence they will actually remember.
 */
export const MIN_PASSPHRASE_LENGTH = 10

export function checkPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new PassphraseError(
      `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters. A sentence you will remember beats a short cryptic string.`,
    )
  }
}
