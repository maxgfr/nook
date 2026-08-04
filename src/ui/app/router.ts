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
 *
 * That same property is what makes `#/read/` possible: a shared page travels
 * as an encrypted blob inside the fragment, which means the bytes reach the
 * recipient's browser without ever reaching GitHub's servers, or anyone else's.
 */

const DOC_PREFIX = '#/doc/'
const READ_PREFIX = '#/read/'

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'doc'; readonly id: DocId }
  /** A page someone shared, still encrypted. Only the reader can open it. */
  | { readonly kind: 'read'; readonly payload: string }

function parse(hash: string): Route {
  if (hash.startsWith(DOC_PREFIX)) {
    const id = decodeURIComponent(hash.slice(DOC_PREFIX.length))
    return id === '' ? { kind: 'home' } : { kind: 'doc', id }
  }
  if (hash.startsWith(READ_PREFIX)) {
    const payload = hash.slice(READ_PREFIX.length)
    return payload === '' ? { kind: 'home' } : { kind: 'read', payload }
  }
  return { kind: 'home' }
}

/**
 * The parsed route, cached against the fragment it came from.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders while
 * they differ. Parsing afresh on every call returns a new object every time,
 * which never settles — the component would re-render until the tab gave up.
 */
let lastHash: string | null = null
let lastRoute: Route = { kind: 'home' }

function readRoute(): Route {
  const hash = globalThis.location?.hash ?? ''
  if (hash !== lastHash) {
    lastHash = hash
    lastRoute = parse(hash)
  }
  return lastRoute
}

const HOME: Route = { kind: 'home' }

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener('hashchange', onChange)
  return () => globalThis.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, readRoute, () => HOME)
}

export function useOpenDocId(): DocId | null {
  const route = useRoute()
  return route.kind === 'doc' ? route.id : null
}

export function useNavigate(): (id: DocId | null) => void {
  return useCallback((id: DocId | null) => {
    const next = id === null ? '#/' : `${DOC_PREFIX}${encodeURIComponent(id)}`
    if (globalThis.location.hash !== next) globalThis.location.hash = next
  }, [])
}

/** The address to hand to someone, for a share that fits in one. */
export function shareLink(payload: string): string {
  const { origin, pathname } = globalThis.location
  return `${origin}${pathname}${READ_PREFIX}${payload}`
}
