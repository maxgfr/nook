import { useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { hostOf, resolveEmbed } from '../../core/policy'
import { useOptionalVault } from '../app/VaultProvider'
import { useOpenSettings } from '../app/openSettings'
import { WEB_ACCESS } from '../app/webAccess'
import { Button } from '../design/Button'
import { copyRemoteImage } from './remoteImage'

/**
 * Anything in a page that lives on somebody else's server.
 *
 * One block for the three cases rather than three, because they differ only in
 * what would be fetched and share the thing that matters: **when Nook is not
 * allowed to fetch it, the block still says exactly what is there.** The
 * alternative — leaving a native image block to fail against the policy — puts
 * a broken frame on the page with nothing to explain it, which is the failure
 * mode this project keeps refusing (see `emoji-mart-absent.ts`).
 *
 * The block is never inserted by hand. Pasting a picture or a video address
 * into the editor produces a native media block, and the normalising pass in
 * `DocEditor` turns it into this one the moment it notices the address is
 * remote. So the honest version is what you get by doing the ordinary thing.
 */

type Kind = 'image' | 'frame' | 'link'
type Decision = 'undecided' | 'live'

export const createWebEmbedSpec = createReactBlockSpec(
  {
    type: 'webEmbed',
    propSchema: {
      url: { default: '' },
      kind: { default: 'link' as Kind, values: ['image', 'frame', 'link'] as const },
      /**
       * Whether the user has accepted that this one is fetched on every open.
       *
       * Stored in the document rather than held in the component: a choice that
       * had to be made again on every visit would not be a choice, it would be
       * a nag.
       */
      decision: { default: 'undecided' as Decision, values: ['undecided', 'live'] as const },
    },
    content: 'none',
  },
  {
    render: (props) => (
      <WebEmbedBlock
        url={props.block.props.url}
        kind={props.block.props.kind}
        decision={props.block.props.decision}
        onDecide={(decision) => props.editor.updateBlock(props.block, { props: { decision } })}
        onCopied={(blobId) =>
          // Once the bytes are in the vault the picture is an ordinary local
          // one, so it goes back to BlockNote's own image block and gets its
          // resizing, its caption and its toolbar. The cast is here because the
          // spec's own types only know about `webEmbed`.
          (
            props.editor as unknown as {
              updateBlock: (
                block: unknown,
                update: { type: 'image'; props: { url: string } },
              ) => void
            }
          ).updateBlock(props.block, { type: 'image', props: { url: `nook:${blobId}` } })
        }
      />
    ),
    /**
     * What leaves in an export.
     *
     * A picture becomes an `<img>` so Markdown renders `![](…)` and the file is
     * still a picture somewhere else. Everything else becomes a link: a player
     * cannot survive the trip, and writing the destination out is the one thing
     * that always survives.
     */
    toExternalHTML: (props) =>
      props.block.props.kind === 'image' ? (
        <img src={props.block.props.url} alt="" />
      ) : (
        <a href={props.block.props.url}>{props.block.props.url}</a>
      ),
  },
)

function WebEmbedBlock({
  url,
  kind,
  decision,
  onDecide,
  onCopied,
}: {
  url: string
  kind: Kind
  decision: Decision
  onDecide: (decision: Decision) => void
  onCopied: (blobId: string) => void
}) {
  // Null when this block is being shown by the reader for a shared page. There
  // is nowhere to copy a picture *to* in that case, so the offer is withheld
  // rather than shown and then failed.
  const vault = useOptionalVault()
  const openSettings = useOpenSettings()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const host = hostOf(url)
  const embed = kind === 'frame' ? resolveEmbed(url) : null
  const allowed = kind === 'image' ? WEB_ACCESS.remoteImages : WEB_ACCESS.externalEmbeds

  const copy = async () => {
    if (!vault) return
    setBusy(true)
    setFailure(null)
    try {
      const { bytes, type } = await copyRemoteImage(url)
      onCopied(await vault.putBlob({ name: fileNameOf(url), type, bytes }))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  // A player from a host Nook has no embed address for. Turning the setting on
  // cannot help, so it is not offered — the frame directive names a closed list.
  if (kind === 'frame' && !embed) {
    return (
      <Plaque url={url}>
        <p>
          Nook does not know how to embed <Host>{host}</Host>, so it holds the address and nothing
          else.
        </p>
      </Plaque>
    )
  }

  if (kind === 'link') {
    return (
      <Plaque url={url}>
        <p>
          A page on <Host>{host}</Host>. Nook keeps the address and never asks for it.
        </p>
      </Plaque>
    )
  }

  if (!allowed) {
    return (
      <Plaque url={url} onOpenSettings={openSettings}>
        <p>
          {kind === 'image' ? (
            <>
              A picture on <Host>{host}</Host>. Nook has not asked for it — loading it would tell{' '}
              {host} that you are reading this page.
            </>
          ) : (
            <>
              A {embed?.label} player. Nook has not contacted them — playing it would tell them that
              you are watching.
            </>
          )}
        </p>
      </Plaque>
    )
  }

  if (kind === 'frame' && embed) {
    return (
      <figure className="my-2">
        <iframe
          src={embed.embedUrl}
          title={`${embed.label} player`}
          /*
           * The origin goes, and nothing more.
           *
           * This was `no-referrer`, on the reasoning that withholding it cost
           * the provider nothing. That was wrong, and the way it was wrong is
           * worth keeping: since late 2025 YouTube refuses to play at all
           * without a `Referer`, and shows "Error 153, video player
           * configuration error" — so the strictest setting bought no privacy
           * and lost the whole feature.
           *
           * `strict-origin-when-cross-origin` sends the origin alone —
           * `https://maxgfr.github.io` — never the path. Which note you are
           * reading is in the URL fragment, and a fragment is never sent in a
           * `Referer` at all. So what the provider learns is that somebody on
           * this site opened a player, which is implied by embedding one.
           */
          referrerPolicy="strict-origin-when-cross-origin"
          /*
           * What the player is allowed to be.
           *
           * What the list withholds is the part that matters: no forms, no
           * popups, no downloads, no modals, and above all no
           * `allow-top-navigation`, so a player cannot navigate the notebook
           * out from under you.
           *
           * The linter objects to `allow-scripts` together with
           * `allow-same-origin`, and it is right to in general: a frame on
           * *our own* origin could then reach in and strip its own sandbox.
           * That cannot happen here. `frame-src` names a closed list of two
           * provider hosts, so this frame is cross-origin by construction, and
           * `allow-same-origin` grants it nothing but the right to be itself —
           * no access to this page, its storage or its key. Removing it does
           * not make anything safer; it makes the player show an error instead
           * of a video, which is the whole thing the setting exists to allow.
           */
          // oxlint-disable-next-line react/iframe-missing-sandbox
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="encrypted-media; picture-in-picture; fullscreen"
          className="aspect-video w-full rounded-md border border-line bg-sunken"
        />
        <figcaption className="mt-1 text-2xs text-ink-faint">
          Played by {embed.label}, who therefore know you opened this page.
        </figcaption>
      </figure>
    )
  }

  // A picture, allowed, and not yet decided: the choice is offered before
  // anything is requested. Both buttons are honest about what they cost, and
  // neither is preselected by loading the picture first to show a preview —
  // that would be making the request while pretending to ask.
  if (decision === 'undecided') {
    return (
      <Plaque url={url} onOpenSettings={null}>
        <p>
          A picture on <Host>{host}</Host>. How should Nook hold it?
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {vault && (
            <Button tone="primary" size="sm" disabled={busy} onClick={() => void copy()}>
              {busy ? `Asking ${host}…` : 'Copy it into the vault'}
            </Button>
          )}
          <Button size="sm" className="border border-line" onClick={() => onDecide('live')}>
            Keep the link
          </Button>
        </div>
        <p className="mt-2 text-2xs text-ink-faint">
          Copying asks {host} once, now, and never again: the picture becomes part of the note,
          works offline and travels with an export. It is re-encoded as a PNG, so an animation
          becomes a still. Keeping the link asks {host} every time this page is opened.
        </p>
        {failure && (
          <p role="status" className="mt-2 text-2xs text-warning">
            {failure}
          </p>
        )}
      </Plaque>
    )
  }

  return (
    <figure className="my-2">
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="max-w-full rounded-md border border-line"
      />
      <figcaption className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-ink-faint">
        <span>Asked of {host} every time this page opens.</span>
        {vault && (
          <Button size="sm" disabled={busy} onClick={() => void copy()}>
            {busy ? 'Copying…' : 'Copy it into the vault instead'}
          </Button>
        )}
      </figcaption>
      {failure && (
        <p role="status" className="mt-1 text-2xs text-warning">
          {failure}
        </p>
      )}
    </figure>
  )
}

/**
 * The shape shown whenever nothing has been fetched.
 *
 * Always states the destination. A block that says "blocked" and nothing else
 * leaves someone unable to judge whether they want it, which is the decision
 * the whole feature exists to give them.
 */
function Plaque({
  url,
  children,
  onOpenSettings,
}: {
  url: string
  children: React.ReactNode
  onOpenSettings?: (() => void) | null
}) {
  return (
    <div className="my-2 rounded-md border border-line border-dashed bg-sunken p-3 text-sm text-ink-muted">
      {children}
      <p className="mt-1 truncate font-mono text-2xs text-ink-faint" title={url}>
        {url}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {onOpenSettings && (
          <Button size="sm" className="border border-line" onClick={onOpenSettings}>
            Open Settings
          </Button>
        )}
        {/*
          A link, not a fetch. Following it is a navigation the reader decides
          on, in a tab of their own — the page itself still asks for nothing.
        */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-6 items-center rounded-sm px-2 text-xs text-ink-muted transition-colors duration-(--nook-dur-fast) ease-nook hover:bg-hover hover:text-ink"
        >
          Open in a new tab
        </a>
      </div>
    </div>
  )
}

function Host({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>
}

/** A name for the stored file, so an export is not a pile of `blob`s. */
function fileNameOf(url: string): string {
  const last = url.split('?')[0]?.split('/').at(-1) ?? ''
  return last.trim() === '' ? 'picture.png' : last
}
