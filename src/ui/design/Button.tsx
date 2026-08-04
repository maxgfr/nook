import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Le seul bouton de l'application.
 *
 * Un composant unique plutôt que des classes recopiées : quand la même action
 * a deux apparences selon l'écran, l'une des deux est un défaut. Les états
 * (survol, focus, actif, désactivé) sont définis une fois ici et valent
 * partout.
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
 * Bouton carré ne portant qu'une icône. `label` n'est pas optionnel : une
 * icône seule n'a pas de nom accessible, et un lecteur d'écran annoncerait
 * « bouton » sans plus de précision.
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
