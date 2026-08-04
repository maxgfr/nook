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
 * Opens the vault once for the whole application and makes it available.
 *
 * The subscription goes through `useSyncExternalStore`: the vault reports its
 * changes with a plain callback, knowing nothing about React. That is what
 * lets `src/core` stay an ordinary TypeScript library, testable without a
 * render.
 */

type State =
  | { readonly status: 'opening' }
  | { readonly status: 'ready'; readonly vault: Vault }
  | { readonly status: 'failed'; readonly error: Error }

/** What the application shows while the vault is not open yet. */
export type BootState = Exclude<State, { status: 'ready' }>

const VaultContext = createContext<Vault | null>(null)

export function VaultProvider({
  children,
  fallback: Fallback,
}: {
  children: ReactNode
  /**
   * A component, not a render function: an arrow function written in the
   * parent's JSX would create a brand-new component type on every render, and
   * React would remount its whole subtree each time.
   */
  fallback: ComponentType<{ state: BootState }>
}) {
  const [state, setState] = useState<State>({ status: 'opening' })

  useEffect(() => {
    let cancelled = false

    Vault.open()
      .then((vault) => {
        // In strict mode React mounts the effect twice: the first
        // opening is cancelled and must be closed, otherwise two
        // connections to the database stay open and block any migration.
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
  if (!vault) throw new Error('useVault must be called inside a <VaultProvider>.')
  return vault
}

/** Redraws the component on every change to the index. */
export function useVaultIndex(): VaultIndex {
  const vault = useVault()
  return useSyncExternalStore(
    useCallback((onChange: () => void) => vault.subscribe(onChange), [vault]),
    useCallback(() => vault.index, [vault]),
  )
}
