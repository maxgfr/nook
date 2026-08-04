import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Debounced autosave.
 *
 * There is no "Save" button in Nook, so this module carries the promise of
 * losing nothing. Three moments matter, and forgetting them is the usual way
 * to lose the last paragraph written:
 *
 *   - after a pause in typing (the common case);
 *   - when the tab goes to the background or closes, because a pending timer
 *     will never fire;
 *   - on unmount, typically when changing page.
 *
 * On failure, the changes go back into the queue rather than being thrown
 * away: the next keystroke will retry, and the state moves to `error` so the
 * interface can say so.
 */

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

export function useAutosave<Patch extends object>(
  save: (patch: Patch) => Promise<unknown>,
  delay = 600,
) {
  const [state, setState] = useState<SaveState>('saved')
  const queued = useRef<Partial<Patch>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The save function changes identity on every render; we keep the latest one
  // without recreating `flush`, whose stability the effect cleanup depends on.
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const patch = queued.current
    if (Object.keys(patch).length === 0) return

    queued.current = {}
    setState('saving')
    try {
      await saveRef.current(patch as Patch)
      // A keystroke during the write may have refilled the queue: do not
      // report "saved" while something is still queued.
      setState(Object.keys(queued.current).length > 0 ? 'pending' : 'saved')
    } catch {
      // What has just arrived is newer than what we were trying to write:
      // the queue takes priority over the patch put back into it.
      queued.current = { ...patch, ...queued.current }
      setState('error')
    }
  }, [])

  const schedule = useCallback(
    (patch: Partial<Patch>) => {
      queued.current = { ...queued.current, ...patch }
      setState('pending')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  useEffect(() => {
    const onHidden = () => {
      // `visibilitychange` is the last reliable signal on mobile: `unload`
      // is not guaranteed there when the system closes the tab.
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()

    document.addEventListener('visibilitychange', onHidden)
    globalThis.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      globalThis.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [flush])

  return { state, schedule, flush }
}
