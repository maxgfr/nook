import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import { Vault } from '../../core/vault'
import type { VaultIndex } from '../../core/model/types'

/**
 * Ouvre le coffre une fois pour toute l'application et le met à disposition.
 *
 * L'abonnement passe par `useSyncExternalStore` : le coffre notifie ses
 * changements avec un simple callback, sans rien connaître de React. C'est ce
 * qui permet à `src/core` de rester une bibliothèque TypeScript ordinaire,
 * testable sans rendu.
 */

type State =
  | { readonly status: 'opening' }
  | { readonly status: 'ready'; readonly vault: Vault }
  | { readonly status: 'failed'; readonly error: Error }

/** Ce que voit l'application tant que le coffre n'est pas ouvert. */
export type BootState = Exclude<State, { status: 'ready' }>

const VaultContext = createContext<Vault | null>(null)

export function VaultProvider({
  children,
  fallback: Fallback,
}: {
  children: ReactNode
  /** Composant, et non fonction de rendu : une fonction fléchée écrite dans
   * le JSX du parent créerait un type de composant neuf à chaque rendu, et
   * React remonterait tout son sous-arbre à chaque fois. */
  fallback: ComponentType<{ state: BootState }>
}) {
  const [state, setState] = useState<State>({ status: 'opening' })

  useEffect(() => {
    let cancelled = false

    Vault.open()
      .then((vault) => {
        // En mode strict, React monte l'effet deux fois : la première
        // ouverture est annulée et doit être refermée, sinon deux connexions
        // à la base restent ouvertes et bloquent toute migration.
        if (cancelled) return vault.close()
        setState({ status: 'ready', vault })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'failed',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status !== 'ready') return <Fallback state={state} />

  return <VaultContext value={state.vault}>{children}</VaultContext>
}

export function useVault(): Vault {
  const vault = useContext(VaultContext)
  if (!vault) throw new Error('useVault doit être appelé sous un <VaultProvider>.')
  return vault
}

/** Redessine le composant à chaque modification de l'index. */
export function useVaultIndex(): VaultIndex {
  const vault = useVault()
  return useSyncExternalStore(
    useCallback((onChange: () => void) => vault.subscribe(onChange), [vault]),
    useCallback(() => vault.index, [vault]),
  )
}
