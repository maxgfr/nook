/**
 * Thème clair / sombre.
 *
 * Le rendu ne dépend pas de ce module : `tokens.css` suit déjà le système via
 * `light-dark()`, donc la page est correctement peinte avant même que React
 * démarre. Ce module ne sert qu'à *forcer* un thème, en posant `data-theme`
 * sur <html>, ce qui redéfinit `color-scheme` et rien d'autre.
 */

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'nook.theme'

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    // Mode navigation privée, stockage bloqué : le thème système fera l'affaire.
    return 'system'
  }
}

/**
 * Le thème réellement peint, une fois « système » résolu.
 *
 * Les jetons CSS n'ont pas besoin de cette information — `light-dark()` s'en
 * charge. Elle sert aux composants tiers qui, eux, réclament un mot : c'est le
 * cas de l'éditeur, qui attend `"light"` ou `"dark"` en propriété.
 */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)

  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Le thème reste appliqué pour la session, simplement pas mémorisé.
  }
}
