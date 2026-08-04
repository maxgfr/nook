import { useCallback, useSyncExternalStore } from 'react'
import type { DocId } from '../../core/model/types'

/**
 * Navigation by URL fragment.
 *
 * The fragment rather than `history.pushState` because GitHub Pages serves
 * static files: a URL like `/nook/doc/abc` would return a 404 before the
 * application even starts. The fragment stays client-side.
 *
 * It never leaves the machine — a fragment is not sent to the server — but it
 * does appear in browser history, so it carries only an opaque identifier,
 * never a title.
 */

const PREFIX = '#/doc/'

function readHash(): DocId | null {
  const hash = globalThis.location?.hash ?? ''
  return hash.startsWith(PREFIX) ? decodeURIComponent(hash.slice(PREFIX.length)) || null : null
}

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener('hashchange', onChange)
  return () => globalThis.removeEventListener('hashchange', onChange)
}

export function useOpenDocId(): DocId | null {
  return useSyncExternalStore(subscribe, readHash, () => null)
}

export function useNavigate(): (id: DocId | null) => void {
  return useCallback((id: DocId | null) => {
    const next = id === null ? '#/' : `${PREFIX}${encodeURIComponent(id)}`
    if (globalThis.location.hash !== next) globalThis.location.hash = next
  }, [])
}
