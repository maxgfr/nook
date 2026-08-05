/**
 * Which build this is.
 *
 * The three parts answer three different questions, which is why none of them
 * is redundant. The number says how far along the released line you are; the
 * commit says exactly which bytes, and is the only one of the three that can be
 * looked up afterwards; the date says how old it all is, which is the question
 * someone actually asks when a phone is behaving oddly.
 *
 * Where the values come from — and why the date belongs to the commit rather
 * than the build — is in `vite.config.ts`.
 */

export type Version = {
  readonly number: string
  readonly commit: string
  readonly date: string
}

export const VERSION: Version = {
  number: __APP_VERSION__,
  commit: __APP_COMMIT__,
  date: __APP_DATE__,
}

/** The commit as written when git had nothing to say. */
const UNKNOWN_COMMIT = 'unknown'

/**
 * One line, meant to be read aloud over a phone call or pasted into a bug
 * report: `0.1.0 · a081ec2 · 5 Aug 2026`.
 *
 * Built without a repository — a container image, whose context excludes
 * `.git/` — there is no commit to name, and the date is the build's rather than
 * a commit's. Saying `built 5 Aug 2026` marks both facts in the one place
 * anybody will look, instead of printing `unknown` and letting the date pass for
 * something it is not.
 */
export function describeVersion(version: Version = VERSION): string {
  const parts = [version.number]
  if (version.commit && version.commit !== UNKNOWN_COMMIT) parts.push(version.commit)
  parts.push(`${version.commit === UNKNOWN_COMMIT ? 'built ' : ''}${describeDate(version.date)}`)
  return parts.join(' · ')
}

/**
 * The day, and only the day. An hour would suggest a precision that means
 * nothing here — nobody deploys twice in an afternoon and needs to tell the two
 * apart by clock; that is what the commit is for.
 *
 * English rather than the browser's locale, like every other date the interface
 * draws for itself.
 */
function describeDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return date.toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric' })
}
