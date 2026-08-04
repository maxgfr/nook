import { useEffect, useRef, useState } from 'react'
import { MIN_PASSPHRASE_LENGTH } from '../../core/crypto/kdf'
import { SUGGESTION_BITS, suggestPassphrase } from '../../core/crypto/wordlist'
import {
  encodeShare,
  fitsInLink,
  packShare,
  SHARE_FILE_EXTENSION,
  type SharedPage,
} from '../../core/share'
import { UNTITLED, type DocId } from '../../core/model/types'
import { useVault } from '../app/VaultProvider'
import { shareLink } from '../app/router'
import { Button } from '../design/Button'
import { download, fileNameFrom } from '../design/download'

/**
 * Sharing a page.
 *
 * The dialog's first job is not to collect a passphrase — it is to say what a
 * share actually is, because the honest answer contradicts what people expect
 * from every other tool. There is no server here. What leaves is a copy, and a
 * copy cannot be recalled, cannot be made to expire, and cannot be counted.
 *
 * So this screen offers exactly what it can keep: encryption with a passphrase
 * you choose, and a request to the reader that Nook will pass on. It offers no
 * revocation, because there is none, and it does not dress the date up as one.
 */

type Ready = { link: string | null; file: string; title: string }

export function ShareDialog({
  docId,
  open,
  onClose,
}: {
  docId: DocId
  open: boolean
  onClose: () => void
}) {
  const vault = useVault()
  const dialog = useRef<HTMLDialogElement>(null)

  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [notAfter, setNotAfter] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState<Ready | null>(null)
  const [copied, setCopied] = useState(false)
  const [suggested, setSuggested] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      setPassphrase('')
      setConfirmation('')
      setNotAfter('')
      setNote('')
      setError(null)
      setReady(null)
      setCopied(false)
      setSuggested(false)
      element.showModal()
    }
    if (!open && element.open) element.close()
  }, [open])

  /**
   * A passphrase is recommended, not required.
   *
   * Leaving it empty makes an unencrypted share, which is a reasonable choice
   * for a shopping list and a bad one for anything else — so it is allowed,
   * and said out loud rather than made impossible. What is *not* allowed is a
   * short passphrase: that looks like protection without being any, which is
   * the one state worse than either.
   */
  const unprotected = passphrase === '' && confirmation === ''
  const canBuild =
    unprotected || (passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === confirmation)

  const suggest = () => {
    const suggestion = suggestPassphrase()
    setPassphrase(suggestion)
    setConfirmation(suggestion)
    setSuggested(true)
  }

  const build = async () => {
    setBusy(true)
    setError(null)
    try {
      const source = await vault.buildShare(docId)
      const page: SharedPage = {
        ...source,
        sharedAt: new Date().toISOString(),
        // Sent as a plain date rather than a moment: the sender picked a day,
        // and pretending to a precision they did not give would be inventing it.
        ...(notAfter === '' ? {} : { notAfter: new Date(`${notAfter}T23:59:59`).toISOString() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }

      const encoded = encodeShare(await packShare(page, passphrase))
      setReady({
        link: fitsInLink(encoded) ? shareLink(encoded) : null,
        file: encoded,
        title: source.title,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Share this page"
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
        <h2 className="text-md font-semibold tracking-tight">Share this page</h2>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-sm text-ink-muted">
        <p>
          A shared page is a <strong className="font-medium text-ink">copy</strong>. Once it has
          left, you cannot recall it and you cannot make it stop working — there is no server to
          ask.
        </p>
        <p className="mt-2">
          A passphrase is the only thing that can keep it shut. If you set one, send it by some
          other route than the link itself. The link will also sit in your reader’s browser history,
          and in whatever carried it.
        </p>

        {ready === null ? (
          <>
            <Field label="Passphrase (recommended)">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type={suggested ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(event) => {
                    setPassphrase(event.target.value)
                    setSuggested(false)
                  }}
                  aria-label="Passphrase for this share"
                  placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters, or leave empty`}
                  className="h-8 min-w-56 flex-1 rounded-sm border border-line bg-surface px-2.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-faint"
                />
                <Button size="sm" className="border border-line" onClick={suggest}>
                  Suggest one
                </Button>
              </div>
              {suggested && (
                // Shown rather than hidden behind dots: a suggestion you cannot
                // read is a suggestion you cannot write down or pass on, and it
                // has to leave this screen by some other route than the link.
                <p className="mt-1 text-xs text-ink-faint">
                  Six words drawn at random — {SUGGESTION_BITS} bits, from{' '}
                  <code className="font-mono">crypto.getRandomValues</code>. Copy it somewhere
                  before you close this: Nook keeps no record of it, and cannot open the share
                  without it.
                </p>
              )}
            </Field>

            <Field label="Passphrase again">
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-label="Confirm the passphrase"
                className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-sm outline-none"
              />
              {confirmation !== '' && passphrase !== confirmation && (
                <p className="mt-1 text-xs text-warning">These two do not match.</p>
              )}
              {passphrase !== '' && passphrase.length < MIN_PASSPHRASE_LENGTH && (
                <p className="mt-1 text-xs text-warning">
                  Too short. A short passphrase looks like protection without being any — either
                  make it longer, or leave both boxes empty on purpose.
                </p>
              )}
            </Field>

            {unprotected && (
              <p className="mt-3 rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
                With both boxes empty the page travels <strong>unencrypted</strong>. Anyone who ends
                up with the link — forwarded, in a history, in a server log that captured it — can
                read it. That is a fine choice for a shopping list and a poor one for anything else.
              </p>
            )}

            <Field label="A line for your reader (optional)">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                aria-label="A line for your reader"
                placeholder="Shown above the page"
                className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-sm outline-none placeholder:text-ink-faint"
              />
            </Field>

            <Field label="Ask that it not be read after (optional)">
              <input
                type="date"
                value={notAfter}
                onChange={(event) => setNotAfter(event.target.value)}
                aria-label="Ask that it not be read after"
                className="h-8 rounded-sm border border-line bg-surface px-2.5 text-sm outline-none"
              />
              <p className="mt-1 text-xs text-ink-faint">
                Nook will show your reader this request and decline to open the page past it. That
                is all it is — a request. It is not an expiry, and nothing here can make it one:
                whoever kept the copy and the passphrase can still read them.
              </p>
            </Field>

            <div className="mt-4">
              <Button tone="primary" disabled={!canBuild || busy} onClick={() => void build()}>
                {busy
                  ? 'Encrypting…'
                  : unprotected
                    ? 'Prepare it unencrypted'
                    : 'Prepare the share'}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-ink">
              Ready. Nothing has been sent anywhere — this is yours to pass on.
            </p>

            {ready.link && (
              // Shown, not just copied. The clipboard can be refused, and a
              // link nobody can see is a link nobody can check before sending
              // something private through it.
              <input
                readOnly
                value={ready.link}
                aria-label="The share link"
                onFocus={(event) => event.currentTarget.select()}
                className="mt-3 h-8 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-ink-muted outline-none"
              />
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {ready.link && (
                <Button
                  tone="primary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(ready.link ?? '')
                      .then(() => setCopied(true))
                  }}
                >
                  {copied ? 'Copied' : 'Copy the link'}
                </Button>
              )}
              <Button
                size="sm"
                className="border border-line"
                onClick={() =>
                  download(
                    fileNameFrom(ready.title, UNTITLED, SHARE_FILE_EXTENSION),
                    ready.file,
                    'application/octet-stream',
                  )
                }
              >
                Download the file
              </Button>
            </div>

            {ready.link === null && (
              <p className="mt-2 text-xs text-warning">
                This page is too big to travel as a link — mail servers and chat clients truncate
                long ones, and a truncated share fails at the far end with nothing to say why. The
                file carries the same thing, and opens the same way.
              </p>
            )}

            <p className="mt-2 text-xs text-ink-faint">
              Your reader opens it in Nook and types the passphrase. They need no account, and Nook
              will not create a notebook on their machine unless they ask it to.
            </p>
          </div>
        )}

        {error && (
          <p role="status" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="block text-xs font-medium tracking-wide text-ink-faint uppercase">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}
