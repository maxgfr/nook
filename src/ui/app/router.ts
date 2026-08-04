import { useCallback, useSyncExternalStore } from 'react'
import type { DocId } from '../../core/model/types'

/**
 * Navigation par fragment d'URL.
 *
 * Le fragment plutôt que `history.pushState` parce que GitHub Pages sert des
 * fichiers statiques : une URL comme `/nook/doc/abc` renverrait un 404 avant
 * même que l'application démarre. Le fragment reste côté client.
 *
 * Il ne quitte jamais la machine — un fragment n'est pas envoyé au serveur —
 * mais il apparaît dans l'historique du navigateur, donc il ne contient qu'un
 * identifiant opaque, jamais un titre.
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
