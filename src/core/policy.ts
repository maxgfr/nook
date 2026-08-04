/**
 * What the page is allowed to reach, and how that is decided.
 *
 * Nook's promise is `connect-src 'none'`: the page cannot make a request. Two
 * things people legitimately want — a picture hosted elsewhere, a video player
 * — cannot be built under a policy that strict, because both are fetched by the
 * browser rather than by us. So both are settings, both are off, and both say
 * what they cost.
 *
 * The mechanism rests on one property of CSP: **a policy can be tightened at
 * runtime and never loosened**. Policies accumulate, and a resource must be
 * allowed by every one of them. Concretely:
 *
 * - The build emits two documents. `index.html` forbids remote pictures and
 *   frames outright. `open-web.html` allows both, and differs in nothing else —
 *   `connect-src 'none'` is identical in the two.
 * - On `open-web.html`, the application inserts a second policy at boot naming
 *   only the directives the user has *not* turned on. A policy that mentions
 *   `img-src` and nothing else leaves frames governed by the document's own
 *   policy, which is what lets two independent switches live in one document.
 * - Once inserted, that policy cannot be undone. A later `<meta>` cannot
 *   re-open what an earlier one closed, so a dependency compromised after boot
 *   is stuck with whatever the user chose.
 *
 * This module is the single source of truth for the directive strings. The Vite
 * plugin composes the two documents from them, the boot module tightens from
 * them, and the CI guard checks the built HTML against them. A directive that
 * exists in only one of those three places is a directive that will drift.
 */

export type WebAccess = {
  /** Show pictures hosted elsewhere, rather than only those in the vault. */
  readonly remoteImages: boolean
  /** Allow a player from one of `EMBED_PROVIDERS` to run inside a page. */
  readonly externalEmbeds: boolean
}

export const NO_WEB_ACCESS: WebAccess = { remoteImages: false, externalEmbeds: false }

/**
 * The providers a frame may point at, when embeds are on.
 *
 * A closed list rather than `https:`. `youtube-nocookie.com` is YouTube's own
 * host for embeds that do not set tracking cookies until playback — it is not
 * privacy, but it is strictly less bad than `youtube.com`, and choosing the
 * worse one for no reason would be careless.
 */
export const EMBED_PROVIDERS = [
  { label: 'YouTube', origin: 'https://www.youtube-nocookie.com' },
  { label: 'Vimeo', origin: 'https://player.vimeo.com' },
] as const

export const STRICT_IMG = "img-src 'self' data: blob:"
export const OPEN_IMG = "img-src 'self' data: blob: https:"
export const STRICT_FRAME = "frame-src 'none'"
export const OPEN_FRAME = `frame-src ${EMBED_PROVIDERS.map((p) => p.origin).join(' ')}`

export const STRICT_DOCUMENT = 'index.html'
export const OPEN_DOCUMENT = 'open-web.html'

/**
 * The policy to insert at boot, or `null` when there is nothing left to close.
 *
 * Only the directives being closed are named. Anything omitted stays governed
 * by the document's own policy — which is the whole trick, and the reason a
 * single relaxed document can serve four combinations of settings.
 */
export function tighteningFor(access: WebAccess): string | null {
  const directives = [
    access.remoteImages ? null : STRICT_IMG,
    access.externalEmbeds ? null : STRICT_FRAME,
  ].filter((directive): directive is string => directive !== null)

  return directives.length > 0 ? directives.join('; ') : null
}

/**
 * Which document these settings belong on.
 *
 * The strict document cannot be relaxed by anything, so wanting either feature
 * means being on the other one. Wanting neither means going back, rather than
 * staying on a document whose parsed policy is looser than the user's choice.
 */
export function documentFor(access: WebAccess): string {
  return access.remoteImages || access.externalEmbeds ? OPEN_DOCUMENT : STRICT_DOCUMENT
}

export type ResolvedEmbed = { readonly label: string; readonly embedUrl: string }

/**
 * Turns a page address into the player address for the same thing.
 *
 * Returns `null` for anything not on the list — including a YouTube URL that
 * carries no video id. Guessing would produce a frame pointing at nothing,
 * which fails silently and looks like a bug in Nook.
 */
export function resolveEmbed(url: string): ResolvedEmbed | null {
  const parsed = parseUrl(url)
  if (!parsed || parsed.protocol !== 'https:') return null

  const host = parsed.hostname.replace(/^www\./, '')

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = parsed.searchParams.get('v') ?? idFromPath(parsed.pathname, 'embed')
    return id ? youtube(id) : null
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id ? youtube(id) : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // `vimeo.com/123456` and `player.vimeo.com/video/123456` both end in the id,
    // so the last segment is the answer in either shape. A trailing slash would
    // otherwise make that last segment the empty string.
    const id = parsed.pathname.replace(/\/+$/, '').split('/').at(-1)
    return id && /^\d+$/.test(id)
      ? { label: 'Vimeo', embedUrl: `https://player.vimeo.com/video/${id}` }
      : null
  }

  return null
}

function youtube(id: string): ResolvedEmbed {
  return { label: 'YouTube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` }
}

/** The segment after `marker`, for paths like `/embed/<id>`. */
function idFromPath(pathname: string, marker: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  const at = segments.indexOf(marker)
  return at >= 0 ? (segments[at + 1] ?? null) : null
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * Whether an address is already ours: a file in the vault, inline bytes, or a
 * blob minted in this tab. None of these can reach the network.
 */
export function isLocalUrl(url: string): boolean {
  return /^(nook:|data:|blob:)/.test(url) || !/^[a-z][\w+.-]*:/i.test(url)
}

/**
 * Whether the address names an image file.
 *
 * By extension, which is a guess — plenty of image URLs carry none. It is only
 * used to decide how to *offer* a pasted address, never to decide what is
 * allowed, so a wrong guess costs a choice presented slightly oddly and nothing
 * more.
 */
export function looksLikeImage(url: string): boolean {
  const path = parseUrl(url)?.pathname ?? ''
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(path)
}

/**
 * How a pasted address should be held.
 *
 * - `local` — nothing to decide, it never leaves the machine.
 * - `frame` — a provider on the list, so a player is possible.
 * - `image` — a picture, so copying it into the vault is possible.
 * - `link`  — anything else: written out, never fetched.
 */
export function classifyUrl(url: string): 'local' | 'frame' | 'image' | 'link' {
  if (isLocalUrl(url)) return 'local'
  if (resolveEmbed(url)) return 'frame'
  return looksLikeImage(url) ? 'image' : 'link'
}

/** The host, for the sentence that tells someone who they would be telling. */
export function hostOf(url: string): string {
  return parseUrl(url)?.hostname ?? url
}
