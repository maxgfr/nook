import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  VaultProvider,
  useVault,
  useVaultIndex,
  type BootState,
  type LockControls,
} from './VaultProvider'
import { UnlockScreen } from '../lock/UnlockScreen'
import { SettingsDialog } from '../settings/SettingsDialog'
import { CanvasView } from '../canvas/CanvasView'
import { useNavigate, useOpenDocId, useRoute } from './router'
import { applyTheme, readTheme, type Theme } from './theme'
import { Sidebar } from '../sidebar/Sidebar'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'
import { CommandPalette } from '../search/CommandPalette'
import { OpenSettingsContext } from './openSettings'
import type { SharedPage } from '../../core/share'
import type { DocId } from '../../core/model/types'

/**
 * The editor alone accounts for most of the application's weight. Taking it
 * out of the initial load makes the sidebar appear immediately, and its
 * chunk is only fetched when a page is opened. The service worker having
 * precached it, the application stays usable offline.
 */
const DocEditor = lazy(() =>
  import('../editor/DocEditor').then((module) => ({ default: module.DocEditor })),
)

/**
 * The reader for a shared page is loaded on demand: someone who never opens a
 * share should not pay for it, and someone who only opens a share should not
 * pay for the notebook.
 */
const ReaderView = lazy(() =>
  import('../share/ReaderView').then((module) => ({ default: module.ReaderView })),
)

const ImportSharedPage = lazy(() =>
  import('../share/ReaderView').then((module) => ({ default: module.ImportSharedPage })),
)

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => applyTheme(theme), [theme])
  const route = useRoute()

  /**
   * The shared page being imported, once its reader has asked for that.
   *
   * Held here rather than inside the reader because the vault has to outlive
   * the reader. Importing ends by opening the page it created, which changes
   * the address from `#/read/…` to `#/doc/…`; keeping the provider at this one
   * position across that change is what lets the notebook someone has just
   * unlocked stay unlocked, instead of asking for the passphrase again on
   * arrival at their own page.
   */
  const [importing, setImporting] = useState<SharedPage | null>(null)

  // The share route is answered **before** the vault provider is mounted, and
  // that ordering is the guarantee: opening a link somebody sent must not
  // create an encrypted notebook on the reader's machine. Nothing touches
  // storage until they press the button that says it will.
  if (route.kind === 'read' && importing === null) {
    return (
      <Suspense fallback={<div className="h-full" aria-busy="true" />}>
        <ReaderView payload={route.payload} onImport={setImporting} />
      </Suspense>
    )
  }

  return (
    <VaultProvider fallback={Boot}>
      {route.kind === 'read' && importing !== null ? (
        <Suspense fallback={<div className="h-full" aria-busy="true" />}>
          <ImportSharedPage page={importing} onCancel={() => setImporting(null)} />
        </Suspense>
      ) : (
        <Workspace theme={theme} onThemeChange={setTheme} />
      )}
    </VaultProvider>
  )
}

function Workspace({ theme, onThemeChange }: { theme: Theme; onThemeChange: (t: Theme) => void }) {
  const openId = useOpenDocId()
  const navigate = useNavigate()
  const index = useVaultIndex()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  // Handed down so a block that has just declined to load something can offer
  // to take you to the switch that would allow it. Stable, or every block in
  // the page would re-render whenever anything else here changed.
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K on macOS, Ctrl+K elsewhere. The browser reserves neither.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [])

  // A page deleted in another tab, or a shared address matching nothing:
  // we fall back to the home screen rather than showing an
  // error for an identifier that simply no longer exists.
  const current = openId && index.docs[openId] ? openId : null

  useResumeLastPage(current, navigate)

  if (mapOpen) {
    return (
      <CanvasView
        onOpen={(id) => {
          navigate(id)
          setMapOpen(false)
        }}
        onClose={() => setMapOpen(false)}
      />
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar openId={current} onOpen={navigate} />
      <main className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
            <OpenSettingsContext value={openSettings}>
              <DocEditor docId={current} />
            </OpenSettingsContext>
          </Suspense>
        ) : (
          <Welcome />
        )}
      </main>
      <BottomBar
        theme={theme}
        onThemeChange={onThemeChange}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenMap={() => setMapOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenDoc={navigate}
      />
    </div>
  )
}

/**
 * Opens the page you were last in, when you arrive with no page named.
 *
 * "No page open" is the right thing to show someone who has no pages. Showing
 * it to someone with two hundred, every time they come back, is asking them to
 * find their way home each morning — the notebook already knows which page they
 * were on, because it knows which one they last wrote in.
 *
 * **Once per session, and only from the home address.** The guard is not
 * defensive habit: without it, closing a page would be impossible — the moment
 * the address became `#/`, this would put you straight back where you came
 * from. So it runs at startup and then stands aside for good.
 *
 * An address naming a page always wins, so a link someone sent, a bookmark, or
 * a reload of the page you are reading all land where they say they will.
 */
function useResumeLastPage(current: DocId | null, navigate: (id: DocId | null) => void) {
  const index = useVaultIndex()
  const done = useRef(false)

  useEffect(() => {
    if (done.current || current !== null) return
    done.current = true

    const mostRecent = Object.values(index.docs).toSorted((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0]

    // No pages at all is the one case the empty state is genuinely for, and it
    // is the case where it teaches something: it offers the first page.
    if (mostRecent) navigate(mostRecent.id)
  }, [current, index, navigate])
}

/**
 * The application's empty state.
 *
 * It teaches the interface instead of noting its emptiness: the one useful
 * action is offered, and the product's promise is restated where it is put to
 * the test — on first launch, when you decide whether to trust it.
 */
function Welcome() {
  const vault = useVault()
  const navigate = useNavigate()

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <Icon name="page" className="size-7 text-ink-faint" />
      <h1 className="mt-4 text-lg font-semibold tracking-tight">No page open</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        Your pages are encrypted and kept on this device. Nothing is sent anywhere — the page
        forbids itself any outgoing request.
      </p>
      <Button
        tone="primary"
        className="mt-6"
        onClick={() => void vault.createDoc().then((doc) => navigate(doc.id))}
      >
        New page
      </Button>
    </div>
  )
}

function Boot({ state, controls }: { state: BootState; controls: LockControls }) {
  if (state.status === 'locked') {
    return <UnlockScreen controls={controls} {...(state.error ? { error: state.error } : {})} />
  }

  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      {state.status === 'opening' ? (
        // Deliberately silent: opening the vault takes a few milliseconds,
        // and a loading message that flashes is worse than nothing.
        <span className="sr-only">Opening the vault…</span>
      ) : (
        <div className="max-w-md">
          <h1 className="text-md font-semibold tracking-tight">The vault could not be opened</h1>
          <p className="mt-2 text-sm text-ink-muted">{state.error.message}</p>
          <p className="mt-4 text-xs text-ink-faint">
            If another Nook window is open, close it and reload.
          </p>
        </div>
      )}
    </div>
  )
}

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function BottomBar({
  theme,
  onThemeChange,
  onOpenPalette,
  onOpenSettings,
  onOpenMap,
}: {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onOpenPalette: () => void
  onOpenSettings: () => void
  onOpenMap: () => void
}) {
  return (
    <div className="fixed right-3 bottom-3 flex items-center gap-1">
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-raised/90 px-2.5 text-2xs text-ink-faint backdrop-blur-sm transition-colors duration-(--nook-dur-fast) ease-nook hover:text-ink"
      >
        Search
        <kbd className="rounded-xs border border-line px-1 font-sans">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={onOpenMap}
        className="flex h-7 items-center rounded-lg border border-line bg-raised/90 px-2.5 text-2xs text-ink-faint backdrop-blur-sm transition-colors duration-(--nook-dur-fast) ease-nook hover:text-ink"
      >
        Map
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex h-7 items-center rounded-lg border border-line bg-raised/90 px-2.5 text-2xs text-ink-faint backdrop-blur-sm transition-colors duration-(--nook-dur-fast) ease-nook hover:text-ink"
      >
        Settings
      </button>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex items-center gap-0.5 rounded-lg border border-line bg-raised/90 p-0.5 backdrop-blur-sm"
      >
        {THEMES.map((option) => {
          const selected = option.value === theme
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onThemeChange(option.value)}
              className={[
                'rounded-sm px-2 py-1 text-2xs transition-colors duration-(--nook-dur-fast) ease-nook',
                selected ? 'bg-hover text-ink' : 'text-ink-faint hover:text-ink',
              ].join(' ')}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
