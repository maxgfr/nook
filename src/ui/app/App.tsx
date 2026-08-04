import { lazy, Suspense, useEffect, useState } from 'react'
import { VaultProvider, useVault, useVaultIndex, type BootState } from './VaultProvider'
import { useNavigate, useOpenDocId } from './router'
import { applyTheme, readTheme, type Theme } from './theme'
import { Sidebar } from '../sidebar/Sidebar'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'
import { CommandPalette } from '../search/CommandPalette'

/**
 * The editor alone accounts for most of the application's weight. Taking it
 * out of the initial load makes the sidebar appear immediately, and its
 * chunk is only fetched when a page is opened. The service worker having
 * precached it, the application stays usable offline.
 */
const DocEditor = lazy(() =>
  import('../editor/DocEditor').then((module) => ({ default: module.DocEditor })),
)

export function App() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => applyTheme(theme), [theme])

  return (
    <VaultProvider fallback={Boot}>
      <Workspace theme={theme} onThemeChange={setTheme} />
    </VaultProvider>
  )
}

function Workspace({ theme, onThemeChange }: { theme: Theme; onThemeChange: (t: Theme) => void }) {
  const openId = useOpenDocId()
  const navigate = useNavigate()
  const index = useVaultIndex()
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  return (
    <div className="flex h-full">
      <Sidebar openId={current} onOpen={navigate} />
      <main className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
            <DocEditor docId={current} />
          </Suspense>
        ) : (
          <Welcome />
        )}
      </main>
      <ThemePicker
        value={theme}
        onChange={onThemeChange}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenDoc={navigate}
      />
    </div>
  )
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

function Boot({ state }: { state: BootState }) {
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

function ThemePicker({
  value,
  onChange,
  onOpenPalette,
}: {
  value: Theme
  onChange: (theme: Theme) => void
  onOpenPalette: () => void
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
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex items-center gap-0.5 rounded-lg border border-line bg-raised/90 p-0.5 backdrop-blur-sm"
      >
        {THEMES.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
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
