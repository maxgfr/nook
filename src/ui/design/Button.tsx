import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * The application's only button.
 *
 * One component rather than copied-around classes: when the same action has
 * two appearances depending on the screen, one of them is a defect. The
 * states (hover, focus, active, disabled) are defined once here and hold
 * everywhere.
 */

type Tone = 'neutral' | 'primary' | 'danger'
type Size = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap ' +
  'transition-colors duration-(--nook-dur-fast) ease-nook ' +
  'disabled:pointer-events-none disabled:opacity-45'

const TONES: Record<Tone, string> = {
  neutral: 'bg-transparent text-ink-muted hover:bg-hover hover:text-ink active:bg-active',
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  danger: 'bg-danger text-white hover:brightness-110',
}

const SIZES: Record<Size, string> = {
  sm: 'h-6 px-2 text-xs',
  md: 'h-8 px-3 text-sm',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone
  size?: Size
  children?: ReactNode
}

export function Button({ tone = 'neutral', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={[BASE, TONES[tone], SIZES[size], className].filter(Boolean).join(' ')}
    />
  )
}

/**
 * A square button carrying only an icon. `label` is not optional: an icon on
 * its own has no accessible name, and a screen reader would announce
 * "button" and nothing more.
 */
export function IconButton({
  label,
  size = 'md',
  tone = 'neutral',
  className,
  ...props
}: Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={[BASE, TONES[tone], size === 'sm' ? 'size-6' : 'size-8', 'shrink-0', className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
