import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Sauvegarde automatique, temporisée.
 *
 * Il n'y a pas de bouton « Enregistrer » dans Nook, donc c'est ce module qui
 * porte la promesse de ne rien perdre. Trois moments comptent, et les oublier
 * est la façon habituelle de perdre le dernier paragraphe écrit :
 *
 *   - après une pause dans la frappe (le cas courant) ;
 *   - quand l'onglet passe en arrière-plan ou se ferme, car une temporisation
 *     en attente ne se déclenchera jamais ;
 *   - au démontage, typiquement en changeant de page.
 *
 * En cas d'échec, les modifications sont remises dans la file plutôt que
 * jetées : la frappe suivante réessaiera, et l'état passe à `error` pour que
 * l'interface puisse le dire.
 */

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

export function useAutosave<Patch extends object>(
  save: (patch: Patch) => Promise<unknown>,
  delay = 600,
) {
  const [state, setState] = useState<SaveState>('saved')
  const queued = useRef<Partial<Patch>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // La sauvegarde change d'identité à chaque rendu ; on garde la dernière sans
  // recréer `flush`, dont la stabilité est indispensable au nettoyage d'effet.
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
      // Une frappe pendant l'écriture a pu remplir la file à nouveau : ne pas
      // annoncer « enregistré » tant qu'il reste quelque chose en attente.
      setState(Object.keys(queued.current).length > 0 ? 'pending' : 'saved')
    } catch {
      // Ce qui vient d'arriver est plus récent que ce qu'on tentait d'écrire :
      // la file garde la priorité sur le patch remis dedans.
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
      // `visibilitychange` est le dernier signal fiable sur mobile : `unload`
      // n'y est pas garanti quand le système referme l'onglet.
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
