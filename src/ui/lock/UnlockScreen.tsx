import { useState } from 'react'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'
import type { LockControls } from '../app/VaultProvider'

/**
 * The screen standing between a passphrase vault and its contents.
 *
 * It shows nothing about the notes — not a count, not a title. A lock screen
 * that leaks how much is inside has already given away more than it should.
 *
 * The message on a wrong passphrase says exactly that, and does not hint at
 * recovery, because there is none: no server holds a copy, so a forgotten
 * passphrase is final. Saying so plainly is kinder than implying otherwise.
 */
export function UnlockScreen({ controls, error }: { controls: LockControls; error?: string }) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (passphrase === '' || busy) return
    setBusy(true)
    try {
      await controls.unlock(passphrase)
    } finally {
      // Cleared either way: a failed attempt should not leave the secret in a
      // field someone can reveal from the DOM inspector.
      setPassphrase('')
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="w-full max-w-sm text-center"
      >
        <Icon name="page" className="mx-auto size-7 text-ink-faint" />
        <h1 className="mt-4 text-lg font-semibold tracking-tight">Nook is locked</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your notes are encrypted on this device. Enter your passphrase to open them.
        </p>

        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          aria-label="Passphrase"
          aria-invalid={error !== undefined}
          placeholder="Passphrase"
          className="mt-6 h-10 w-full rounded-sm border border-line bg-surface px-3 text-center text-base text-ink outline-none placeholder:text-ink-faint"
        />

        {error !== undefined && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button
          type="submit"
          tone="primary"
          className="mt-4 w-full"
          disabled={passphrase === '' || busy}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>

        <p className="mt-6 text-xs text-ink-faint">
          There is no way to recover a forgotten passphrase. Nothing about this vault is stored
          anywhere but on this device.
        </p>
      </form>
    </div>
  )
}
