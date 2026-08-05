import { useEffect, useRef } from 'react'

/**
 * The keyboard, and the chips that teach it.
 *
 * One module rather than a listener per component: the shortcuts have to agree
 * about which modifier they take and what they print, and a second copy of that
 * decision is how an interface ends up telling you ⌘ on a machine that has no
 * ⌘ key.
 */

/**
 * What the modifier is called here.
 *
 * The handlers below accept either Meta or Control, because a notebook opened
 * on someone else's machine should not need to know whose it is. Only the label
 * has to choose, and it chooses by the machine it is being read on.
 */
export const MOD = /Mac|iP(hone|ad|od)/.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
)
  ? '⌘'
  : 'Ctrl'

/** How a combination is written on a chip: `⌘S`, `⇧⌘S`, `Ctrl+Shift+S`. */
export function shortcutLabel(key: string, shift = false): string {
  const letter = key.toUpperCase()
  if (MOD === '⌘') return `${shift ? '⇧' : ''}⌘${letter}`
  return `Ctrl+${shift ? 'Shift+' : ''}${letter}`
}

/**
 * Runs something when a combination is pressed, while this is on screen.
 *
 * `preventDefault` fires only when the shortcut is going to act. That is the
 * whole reason for `enabled`: ⌘S in a browser offers to write the application's
 * own HTML to disk, which is never what someone pressing it inside a notebook
 * meant — but swallowing the key on a page that has nothing to export would be
 * worse than letting the browser have it back.
 *
 * The handler is read through a ref so that a shortcut does not re-register on
 * every render of the component that owns it.
 */
export function useShortcut(
  key: string,
  run: () => void,
  options: { shift?: boolean; enabled?: boolean } = {},
): void {
  const { shift = false, enabled = true } = options
  const latest = useRef(run)
  latest.current = run

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.shiftKey !== shift) return
      // Shift changes `key` to the capital, so both are folded down.
      if (event.key.toLowerCase() !== key.toLowerCase()) return

      event.preventDefault()
      latest.current()
    }

    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [key, shift, enabled])
}

/**
 * The chip that teaches one.
 *
 * Hidden on a narrow screen: a phone has no ⌘ key, and the room the chip takes
 * is room the action's own name needs.
 */
export function Shortcut({ keys, className = '' }: { keys: string; className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={`hidden rounded-xs border border-line px-1 font-sans text-2xs text-ink-faint lg:inline ${className}`}
    >
      {keys}
    </kbd>
  )
}
