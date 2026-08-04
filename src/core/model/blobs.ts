import type { JsonValue } from './types'

/**
 * Which files a page's content refers to.
 *
 * Structural, like `extractText`, and for the same reason: the core does not
 * know what a picture block looks like, only that a reference to a stored file
 * is a string beginning `nook:`. That is what keeps this working the day the
 * editor changes its block shapes — and what lets one function answer for
 * pictures, videos, audio and attachments without knowing which is which.
 */

export const BLOB_PREFIX = 'nook:'

export function referencedBlobIds(content: JsonValue): string[] {
  const found = new Set<string>()

  const visit = (node: JsonValue): void => {
    if (typeof node === 'string') {
      if (node.startsWith(BLOB_PREFIX)) {
        const id = node.slice(BLOB_PREFIX.length)
        if (id !== '') found.add(id)
      }
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child)
    } else if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node)) visit(child)
    }
  }

  visit(content)
  return [...found]
}
