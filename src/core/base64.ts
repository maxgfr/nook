/**
 * Bytes as text, and back.
 *
 * Needed because a shared page travels through things that only carry text: a
 * URL fragment, a file someone pastes into a chat window. `JSON.stringify` on a
 * `Uint8Array` produces `{"0":137,"1":80,…}`, which is roughly seven characters
 * per byte — a picture would arrive several times its own size, or not at all.
 *
 * `btoa` is used rather than a hand-rolled table because it is in the platform
 * and correct. Its one trap is the argument list: `String.fromCharCode(...bytes)`
 * spreads every byte into a separate argument and overflows the stack somewhere
 * around a hundred thousand of them — which is a small picture. Hence the
 * chunking, which is the entire reason this file exists rather than two
 * one-line helpers.
 */

/** Comfortably below the argument limit of every engine, and a round number. */
const CHUNK = 0x8000

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }
  return btoa(binary)
}

/**
 * Returns a view over a plain `ArrayBuffer` — the `Bytes` of `crypto/envelope`.
 * WebCrypto refuses anything that might be backed by shared memory, so saying
 * so in the type is what stops the mistake reaching a call to `decrypt`.
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/**
 * The URL-safe alphabet, without padding.
 *
 * `+` and `/` are legal in a fragment but survive copy-and-paste badly — mail
 * clients and chat windows are fond of rewriting them — and `=` invites being
 * mistaken for the end of a parameter. The substitution is reversed on the way
 * back in, so a link written by one version reads the same in the next.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
  // `atob` wants the padding back. The length modulo 4 says how much is missing;
  // a remainder of one is not a length base64 can produce, and `atob` rejects it.
  return fromBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
}
