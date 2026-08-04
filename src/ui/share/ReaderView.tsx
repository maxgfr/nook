import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeShare, isPastNotAfter, unpackShare, type SharedPage } from '../../core/share'
import { fromBase64 } from '../../core/base64'
import { UNTITLED } from '../../core/model/types'
import { useVault, VaultProvider } from '../app/VaultProvider'
import { Button } from '../design/Button'
import { ReadOnlyBlocks } from '../editor/schema'

/**
 * A page someone shared with you.
 *
 * Rendered **outside** `VaultProvider`, and that is the point rather than an
 * implementation detail: opening a link somebody sent you must not create an
 * encrypted notebook on your machine. Nothing here touches storage until you
 * press the one button that says it will.
 *
 * The whole screen runs under the ordinary policy. A share carries its own
 * pictures, so there is nothing to fetch and nothing to allow.
 */
export function ReaderView({ payload }: { payload: string }) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState<SharedPage | null>(null)
  const [overrideDate, setOverrideDate] = useState(false)
  const [adopting, setAdopting] = useState(false)

  const open = async () => {
    setBusy(true)
    setError(null)
    try {
      setPage(await unpackShare(decodeShare(payload), passphrase))
    } catch (cause) {
      // A wrong passphrase and an altered payload are the same event to
      // AES-GCM. The likelier of the two by a wide margin is a typo, so that is
      // what the message says — while `unpackShare` stays exact about what it
      // actually knows.
      setError(
        cause instanceof Error && cause.name === 'DecryptionError'
          ? 'That passphrase does not open this page.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
      )
    } finally {
      setBusy(false)
    }
  }

  if (!page) {
    return (
      <Sheet>
        <h1 className="text-lg font-semibold tracking-tight text-ink">
          Someone shared a page with you
        </h1>
        <p className="mt-2">
          It is encrypted. Nook cannot read it, and neither can anyone who intercepted the link —
          only the passphrase opens it, and that was sent to you some other way.
        </p>

        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void open()
          }}
        >
          <input
            autoFocus
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            aria-label="Passphrase"
            placeholder="Passphrase"
            className="h-8 min-w-56 flex-1 rounded-sm border border-line bg-surface px-2.5 text-sm outline-none placeholder:text-ink-faint"
          />
          <Button tone="primary" type="submit" disabled={busy || passphrase === ''}>
            {busy ? 'Opening…' : 'Open'}
          </Button>
        </form>

        {error && (
          <p role="status" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <p className="mt-6 text-xs text-ink-faint">
          Nothing has been stored on this machine, and nothing has been sent anywhere.
        </p>
      </Sheet>
    )
  }

  if (isPastNotAfter(page) && !overrideDate) {
    return (
      <Sheet>
        <h1 className="text-lg font-semibold tracking-tight text-ink">
          The sender asked that this not be read after {formatDate(page.notAfter)}
        </h1>
        <p className="mt-2">
          Nook is showing you that request. It is{' '}
          <strong className="text-ink">not enforcing</strong> it, and it cannot: this page is a copy
          on your own machine, and anyone holding it and the passphrase can read it whenever they
          like, with this program or another one.
        </p>
        <p className="mt-2">Saying otherwise would be theatre, so the button below is real.</p>
        <div className="mt-4">
          <Button onClick={() => setOverrideDate(true)}>Read it anyway</Button>
        </div>
      </Sheet>
    )
  }

  if (adopting) {
    return (
      <VaultProvider fallback={AdoptBoot}>
        <AdoptIntoNotebook page={page} onCancel={() => setAdopting(false)} />
      </VaultProvider>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-(--nook-measure) px-6 pt-10 pb-24">
        <div
          data-print-hide
          className="mb-6 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-muted"
        >
          <p>
            A page shared with you, opened on this machine only. It is a copy: it will keep working
            whatever the sender does next.
          </p>
          {page.note && <p className="mt-1 text-ink">“{page.note}”</p>}
          {page.notAfter && (
            <p className="mt-1">
              The sender asked that it not be read after {formatDate(page.notAfter)} — a request,
              not a lock.
            </p>
          )}
          <div className="mt-2">
            <Button size="sm" className="border border-line" onClick={() => setAdopting(true)}>
              Save it into my notebook
            </Button>
          </div>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-ink">{page.title || UNTITLED}</h1>
        <div className="mt-6">
          <SharedBlocks page={page} />
        </div>
      </div>
    </div>
  )
}

/**
 * The page's blocks, with its pictures served from the bundle.
 *
 * The object URLs are minted once and released when the reader closes. Without
 * the cleanup, every picture in every share opened in a session would stay
 * resident until the tab was closed.
 */
function SharedBlocks({ page }: { page: SharedPage }) {
  const urls = useRef(new Map<string, string>())

  useEffect(() => {
    const minted = urls.current
    return () => {
      for (const url of minted.values()) URL.revokeObjectURL(url)
      minted.clear()
    }
  }, [])

  const resolveFile = useMemo(() => {
    const byId = new Map(page.files.map((file) => [file.id, file]))

    return async (url: string): Promise<string> => {
      if (!url.startsWith('nook:')) return url
      const id = url.slice('nook:'.length)

      const existing = urls.current.get(id)
      if (existing) return existing

      const file = byId.get(id)
      if (!file) return url

      const minted = URL.createObjectURL(
        new Blob([fromBase64(file.base64)], { type: file.type || 'application/octet-stream' }),
      )
      urls.current.set(id, minted)
      return minted
    }
  }, [page])

  return <ReadOnlyBlocks content={page.content} resolveFile={resolveFile} />
}

/**
 * Copying the page in.
 *
 * Mounted inside its own `VaultProvider`, and only once the button is pressed:
 * this is the moment the reader's notebook is opened — or created, if they had
 * none — and it should happen because they asked, not because they clicked a
 * link.
 */
function AdoptIntoNotebook({ page, onCancel }: { page: SharedPage; onCancel: () => void }) {
  const vault = useVault()
  const [state, setState] = useState<
    { kind: 'asking' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; why: string }
  >({ kind: 'asking' })

  const save = () => {
    setState({ kind: 'saving' })
    vault
      .adoptShare({ title: page.title, content: page.content, files: page.files })
      .then(() => setState({ kind: 'saved' }))
      .catch((cause: unknown) =>
        setState({ kind: 'failed', why: cause instanceof Error ? cause.message : String(cause) }),
      )
  }

  return (
    <Sheet>
      <h1 className="text-lg font-semibold tracking-tight text-ink">Save it into your notebook</h1>
      <p className="mt-2">
        The page is copied in as a new page of your own, at the top level, with its pictures. It
        arrives with no history — it becomes yours from here, not a continuation of the sender’s.
      </p>

      {state.kind === 'saved' ? (
        <p className="mt-4 text-success">Saved. Open Nook to find it at the top level.</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button tone="primary" disabled={state.kind === 'saving'} onClick={save}>
            {state.kind === 'saving' ? 'Saving…' : 'Save it'}
          </Button>
          <Button onClick={onCancel}>Go back to reading</Button>
        </div>
      )}

      {state.kind === 'failed' && (
        <p role="status" className="mt-3 text-sm text-danger">
          {state.why}
        </p>
      )}
    </Sheet>
  )
}

function AdoptBoot() {
  return (
    <Sheet>
      <p>Opening your notebook…</p>
    </Sheet>
  )
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-md text-sm text-ink-muted">{children}</div>
    </div>
  )
}

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
