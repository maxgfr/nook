import { NO_WEB_ACCESS, type WebAccess } from '../../core/policy'

/**
 * Whether the user has let the web in, and which half of it.
 *
 * Kept in `localStorage`, like the theme, and for a harder reason than
 * convenience: this has to be readable **before the vault opens**. The policy
 * is decided in the first module the browser runs, long before there is a key
 * to decrypt anything with, so a setting stored inside the vault could not
 * reach the decision in time.
 *
 * It follows that this preference is per-device rather than per-notebook, which
 * is the right scale anyway — it is a statement about this browser's willingness
 * to make requests, not about the notes.
 *
 * `wipeEverything()` already clears `localStorage`, so erasing everything puts
 * both switches back to off without a line of code here.
 */

const STORAGE_KEY = 'nook.webAccess'

function isWebAccess(value: unknown): value is WebAccess {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WebAccess>
  return (
    typeof candidate.remoteImages === 'boolean' && typeof candidate.externalEmbeds === 'boolean'
  )
}

export function readWebAccess(): WebAccess {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    // Anything unreadable — an older shape, a hand-edited value, storage
    // blocked by the browser — falls back to the closed position. The default
    // has to be the safe one in every failure mode, not only in the expected one.
    return isWebAccess(stored) ? stored : NO_WEB_ACCESS
  } catch {
    return NO_WEB_ACCESS
  }
}

/**
 * The access in force for this document, settled once.
 *
 * Changing either switch reloads the page, so the value read when this module
 * is first evaluated is the value for the life of the document. Reading it once
 * also means a note full of blocks does not go to `localStorage` on every
 * render to ask a question whose answer cannot change.
 */
export const WEB_ACCESS: WebAccess = readWebAccess()

export function writeWebAccess(access: WebAccess): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(access))
  } catch {
    // Storage refused. The choice will not survive the reload that applies it,
    // which is precisely why `SettingsDialog` reads the value back afterwards
    // rather than assuming the write landed.
  }
}
