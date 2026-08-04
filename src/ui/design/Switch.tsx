import type { ReactNode } from 'react'

/**
 * A setting that is either on or off.
 *
 * Built on `role="switch"` rather than a checkbox, because the two are not the
 * same promise: a checkbox is a value you are about to submit, a switch takes
 * effect the moment you touch it. Screen readers announce them differently, and
 * these ones do take effect immediately.
 *
 * The label and the description are rendered here rather than left to the
 * caller so that the whole block is the clickable target — a 36-pixel track is
 * a poor thing to ask anyone to aim at.
 */
export function Switch({
  checked,
  onChange,
  label,
  children,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  children?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled ?? false}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-sm p-2 text-left transition-colors duration-(--nook-dur-fast) ease-nook hover:bg-hover disabled:pointer-events-none disabled:opacity-45"
    >
      <span
        aria-hidden="true"
        className={[
          'mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors duration-(--nook-dur) ease-nook',
          checked ? 'bg-accent' : 'bg-line-strong',
        ].join(' ')}
      >
        <span
          className={[
            'size-3 rounded-full bg-raised shadow-menu transition-transform duration-(--nook-dur) ease-nook',
            checked ? 'translate-x-3' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {children && <span className="mt-1 block text-xs text-ink-muted">{children}</span>}
      </span>
    </button>
  )
}
