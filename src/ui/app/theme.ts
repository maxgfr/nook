/**
 * Light / dark theme.
 *
 * Rendering does not depend on this module: `tokens.css` already follows the
 * system via `light-dark()`, so the page is painted correctly before React
 * even starts. This module exists only to *force* a theme, by setting
 * `data-theme` on <html>, which redefines `color-scheme` and nothing else.
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
    // Private browsing, storage blocked: the system theme will do.
    return 'system'
  }
}

/**
 * The theme actually painted, once "system" is resolved.
 *
 * The CSS tokens do not need this information — `light-dark()` handles it. It
 * is for third-party components that do want a word: the editor is one, and
 * expects `"light"` or `"dark"` as a prop.
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
    // The theme stays applied for the session, simply not remembered.
  }
}
