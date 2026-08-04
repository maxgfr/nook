import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
 * changes with a plain callback, knowing nothing about React. That is what lets
 * `src/core` stay an ordinary TypeScript library, testable without a render.
 *
 * Locking is handled here rather than in the vault, because "locked" is a state
 * of the *session*, not of the data. Locking simply drops the instance; the key
 * goes with it, and nothing on disk changes.
 */

type State =
  | { readonly status: 'opening' }
  | { readonly status: 'locked'; readonly error?: string }
  | { readonly status: 'ready'; readonly vault: Vault }
  | { readonly status: 'failed'; readonly error: Error }

/** What the application shows while the vault is not open yet. */
export type BootState = Exclude<State, { status: 'ready' }>

export type LockControls = {
  readonly unlock: (passphrase: string) => Promise<void>
  readonly lock: () => void
}

const VaultContext = createContext<Vault | null>(null)
const LockContext = createContext<LockControls | null>(null)

/** Minutes of inactivity before a passphrase vault locks itself. */
export const AUTO_LOCK_MINUTES = 15

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
  fallback: ComponentType<{ state: BootState; controls: LockControls }>
}) {
  const [state, setState] = useState<State>({ status: 'opening' })
  const vaultRef = useRef<Vault | null>(null)

  const lock = useCallback(() => {
    vaultRef.current?.close()
    vaultRef.current = null
    setState({ status: 'locked' })
  }, [])

  const unlock = useCallback(async (passphrase: string) => {
    try {
      const vault = await Vault.unlock(passphrase)
      vaultRef.current = vault
      setState({ status: 'ready', vault })
    } catch (cause) {
      setState({ status: 'locked', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    Vault.inspect()
      .then(async (protection) => {
        if (cancelled) return
        // A passphrase vault must not be opened here: there is nothing to open
        // it with until the user supplies the secret.
        if (protection?.kind === 'passphrase') {
          setState({ status: 'locked' })
          return
        }

        const vault = await Vault.open()
        // In strict mode React mounts the effect twice: the first opening is
        // cancelled and must be closed, otherwise two connections to the
        // database stay open and block any migration.
        if (cancelled) {
          vault.close()
          return
        }
        vaultRef.current = vault
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

  const controls = useMemo<LockControls>(() => ({ unlock, lock }), [unlock, lock])
  const lockable = state.status === 'ready' && state.vault.protection.kind === 'passphrase'
  useAutoLock(lockable, lock)

  return (
    <LockContext value={controls}>
      {state.status === 'ready' ? (
        <VaultContext value={state.vault}>{children}</VaultContext>
      ) : (
        <Fallback state={state} controls={controls} />
      )}
    </LockContext>
  )
}

/**
 * Locks the vault after a spell of inactivity.
 *
 * Only for passphrase vaults: locking a device-protected vault would ask for a
 * secret that does not exist, which is theatre rather than security.
 *
 * The timer restarts on real input, not on any event — a page scrolling under a
 * cat is not someone still working.
 */
function useAutoLock(enabled: boolean, lock: () => void) {
  useEffect(() => {
    if (!enabled) return

    let timer = setTimeout(lock, AUTO_LOCK_MINUTES * 60_000)
    const restart = () => {
      clearTimeout(timer)
      timer = setTimeout(lock, AUTO_LOCK_MINUTES * 60_000)
    }

    const events = ['keydown', 'pointerdown'] as const
    for (const event of events) globalThis.addEventListener(event, restart)

    return () => {
      clearTimeout(timer)
      for (const event of events) globalThis.removeEventListener(event, restart)
    }
  }, [enabled, lock])
}

export function useVault(): Vault {
  const vault = useContext(VaultContext)
  if (!vault) throw new Error('useVault must be called inside a <VaultProvider>.')
  return vault
}

/**
 * The vault if there is one, `null` otherwise.
 *
 * For components that render both inside the notebook and outside it — the
 * editor's blocks are shown again, read-only, when someone opens a page shared
 * with them, and that reader deliberately has no vault open. Throwing there
 * would be right for `useVault` and wrong here: the absence is expected, and
 * what changes is which actions the block offers.
 */
export function useOptionalVault(): Vault | null {
  return useContext(VaultContext)
}

export function useLockControls(): LockControls {
  const controls = useContext(LockContext)
  if (!controls) throw new Error('useLockControls must be called inside a <VaultProvider>.')
  return controls
}

/** Redraws the component on every change to the index. */
export function useVaultIndex(): VaultIndex {
  const vault = useVault()
  return useSyncExternalStore(
    useCallback((onChange: () => void) => vault.subscribe(onChange), [vault]),
    useCallback(() => vault.index, [vault]),
  )
}
