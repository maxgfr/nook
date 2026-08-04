import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLockControls, useVault, AUTO_LOCK_MINUTES } from '../app/VaultProvider'
import { MIN_PASSPHRASE_LENGTH } from '../../core/crypto/kdf'
import type { StorageSurvey } from '../../core/storage/wipe'
import { isEmpty } from '../../core/storage/wipe'
import { Button } from '../design/Button'

/**
 * Settings: how the vault is protected, how to get the data out, and how to
 * destroy it.
 *
 * Three sections in that order on purpose. Someone who came here to erase
 * everything walks past the export on the way, which is the one thing they may
 * regret not doing.
 */

const WIPE_WORD = 'ERASE'

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vault = useVault()
  const { lock } = useLockControls()
  const dialog = useRef<HTMLDialogElement>(null)

  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [exported, setExported] = useState(false)
  const [wipeWord, setWipeWord] = useState('')
  const [remaining, setRemaining] = useState<StorageSurvey | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  const protection = vault.protection.kind

  const run = async (label: string, task: () => Promise<string | void>) => {
    setBusy(label)
    setMessage(null)
    try {
      setMessage((await task()) ?? null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const exportAll = () =>
    run('export', async () => {
      const data = await vault.exportAll()
      download(`nook-${data.exportedAt.slice(0, 10)}.json`, JSON.stringify(data, null, 2))
      setExported(true)
      return `${data.docs.length} page(s) exported.`
    })

  const importFile = (file: File) =>
    run('import', async () => {
      const parsed: unknown = JSON.parse(await file.text())
      const count = await vault.importAll(parsed as Parameters<typeof vault.importAll>[0], 'merge')
      return `${count} page(s) imported.`
    })

  return (
    <dialog
      ref={dialog}
      aria-label="Settings"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-0 text-ink shadow-modal backdrop:bg-black/35"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-md font-semibold tracking-tight">Settings</h2>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <Section title="Protection">
          {protection === 'device' ? (
            <>
              <p>
                Your notes are encrypted with a key held by this browser. That protects a copy of
                your disk or profile. It does not protect against someone using this browser
                session.
              </p>
              <p className="mt-2">
                A passphrase closes that gap. Everything is re-encrypted under a new key, and the
                vault locks itself after {AUTO_LOCK_MINUTES} minutes of inactivity.
              </p>
              <p className="mt-2 text-danger">
                There is no recovery. If you forget it, the notes are gone — export them first.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  aria-label="New passphrase"
                  placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
                  className="h-8 min-w-56 flex-1 rounded-sm border border-line bg-surface px-2.5 text-sm outline-none placeholder:text-ink-faint"
                />
                <Button
                  tone="primary"
                  size="sm"
                  // Gated on an export, not on a checkbox: the only honest way
                  // to make an irreversible step safe is to have made a copy.
                  disabled={!exported || passphrase.length < MIN_PASSPHRASE_LENGTH || busy !== null}
                  onClick={() =>
                    void run('passphrase', async () => {
                      await vault.enablePassphrase(passphrase)
                      setPassphrase('')
                      return 'This vault now requires your passphrase.'
                    })
                  }
                >
                  {busy === 'passphrase' ? 'Re-encrypting…' : 'Protect with a passphrase'}
                </Button>
              </div>
              {!exported && (
                <p className="mt-2 text-xs text-ink-faint">
                  Export your notes below first — the button unlocks once you have a copy.
                </p>
              )}
            </>
          ) : (
            <>
              <p>This vault is protected by a passphrase and locks itself when left idle.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={lock}>
                  Lock now
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('device', async () => {
                      await vault.disablePassphrase()
                      return 'Passphrase removed. The notes stay encrypted on this device.'
                    })
                  }
                >
                  {busy === 'device' ? 'Re-encrypting…' : 'Remove the passphrase'}
                </Button>
              </div>
            </>
          )}
        </Section>

        <Section title="Your data">
          <p>
            The export is a plain JSON file holding every page. It is readable by anything, so keep
            it somewhere you trust.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void exportAll()}>
              {busy === 'export' ? 'Exporting…' : 'Export everything'}
            </Button>
            <label className="inline-flex h-6 cursor-pointer items-center rounded-sm px-2 text-xs text-ink-muted transition-colors duration-(--nook-dur-fast) ease-nook hover:bg-hover hover:text-ink">
              Import a file
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void importFile(file)
                }}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Importing merges into what is already here; pages that would collide are given new
            identifiers rather than overwriting anything.
          </p>
        </Section>

        <Section title="Erase everything" tone="danger">
          <p>
            This destroys the database, the caches, the service worker and every stored preference,
            then reads the storage back to show you what is left.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={wipeWord}
              onChange={(event) => setWipeWord(event.target.value)}
              aria-label={`Type ${WIPE_WORD} to confirm`}
              placeholder={`Type ${WIPE_WORD}`}
              className="h-8 w-40 rounded-sm border border-line bg-surface px-2.5 text-sm outline-none placeholder:text-ink-faint"
            />
            <Button
              tone="danger"
              size="sm"
              disabled={wipeWord !== WIPE_WORD || busy !== null}
              onClick={() =>
                void run('wipe', async () => {
                  setRemaining(await vault.wipe())
                })
              }
            >
              {busy === 'wipe' ? 'Erasing…' : 'Erase everything'}
            </Button>
          </div>

          {remaining && (
            <div role="status" className="mt-3 rounded-sm border border-line p-3 text-xs">
              {isEmpty(remaining) ? (
                <p className="text-success">
                  Nothing left: no database, no cache, no service worker, no stored keys. Reload to
                  start over.
                </p>
              ) : (
                <p className="text-warning">
                  Something remains — databases: {remaining.databases?.join(', ') || 'unknown'},
                  caches: {remaining.caches.length}, service workers: {remaining.serviceWorkers}.
                </p>
              )}
            </div>
          )}
        </Section>

        {message && (
          <p role="status" className="mt-4 text-sm text-ink-muted">
            {message}
          </p>
        )}
      </div>
    </dialog>
  )
}

function Section({
  title,
  tone,
  children,
}: {
  title: string
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <section className="border-b border-line py-4 first:pt-0 last:border-0 last:pb-0">
      <h3
        className={`text-xs font-medium tracking-wide uppercase ${tone === 'danger' ? 'text-danger' : 'text-ink-faint'}`}
      >
        {title}
      </h3>
      <div className="mt-2 text-sm text-ink-muted">{children}</div>
    </section>
  )
}

/**
 * Hands a file to the browser without touching the network.
 *
 * A `blob:` URL is same-origin by construction, so the CSP that forbids every
 * outgoing request has nothing to object to — the bytes never leave the tab.
 */
function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
