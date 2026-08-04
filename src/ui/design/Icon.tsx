import type { SVGProps } from 'react'

/**
 * The application's icons, drawn here rather than pulled from a library:
 * there are few of them, and one coherent family (same 24 grid, same stroke
 * weight, same rounded terminals) beats an assortment.
 */

const paths = {
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 6 6 6-6 6',
  trash:
    'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  page: 'M14 3v5h5M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z',
  sidebar: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM10 4v16',
} as const

export type IconName = keyof typeof paths

export function Icon({
  name,
  className = 'size-4',
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}
