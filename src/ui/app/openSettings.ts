import { createContext, useContext } from 'react'

/**
 * A way to open Settings from somewhere deep in the page.
 *
 * A block that has just refused to load something has to be able to point at
 * the switch that would allow it — telling someone a setting exists without
 * offering to take them there is a small unkindness repeated on every note.
 *
 * Optional on purpose. The reader for a shared page renders the same blocks
 * with no Settings dialog anywhere, and a button that opens nothing is worse
 * than no button.
 */
export const OpenSettingsContext = createContext<(() => void) | null>(null)

export function useOpenSettings(): (() => void) | null {
  return useContext(OpenSettingsContext)
}
