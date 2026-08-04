import { createContext, useContext, useEffect, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'

import { isCollection } from '../../core/model/collection'
import { UNTITLED, type Doc, type DocId } from '../../core/model/types'
import { useNavigate } from '../app/router'
import { useOptionalVault, useVault, useVaultIndex } from '../app/VaultProvider'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'
import { ReadOnlyBlocks } from './schema'

/**
 * Another page of this notebook, shown in place.
 *
 * Nothing leaves the machine: the page is read out of the same vault, decrypted
 * with the same key. This is the only kind of embedding Nook does without
 * asking a question first.
 *
 * The page is shown read-only. Editing an embedded page in place would mean two
 * editors holding the same document with two debounced autosaves racing each
 * other, and the loser silently winning. The title is a link to the real page,
 * which is where editing happens.
 */

/**
 * How deep embedding may go.
 *
 * Every level is a whole editor instance, so this is a cost as much as a
 * safeguard. Three is enough for "a page of notes that gathers three summaries"
 * and short of anything that would make a page take a visible moment to open.
 */
export const MAX_EMBED_DEPTH = 3

/**
 * The pages already being rendered above this one.
 *
 * Without it, a page embedding itself — directly, or through a chain of three
 * others — recurses until the tab dies. With it, the loop is caught and named
 * at the point where it closes, which is also the only place a reader could
 * usefully be told about it.
 */
const EmbedChainContext = createContext<readonly DocId[]>([])

export function EmbedChain({ docId, children }: { docId: DocId; children: React.ReactNode }) {
  const chain = useContext(EmbedChainContext)
  return <EmbedChainContext value={[...chain, docId]}>{children}</EmbedChainContext>
}

export const createPageEmbedSpec = createReactBlockSpec(
  {
    type: 'pageEmbed',
    propSchema: { docId: { default: '' } },
    content: 'none',
  },
  {
    render: (props) => <PageEmbedBlock docId={props.block.props.docId} />,
    /**
     * What leaves in an export.
     *
     * A link, not the embedded text. Markdown has no notion of transclusion, so
     * inlining the content would silently turn one page into two copies of
     * itself — and the copy would then drift from the original with nothing to
     * say which was which.
     */
    toExternalHTML: (props) => <a href={`#/doc/${props.block.props.docId}`}>Embedded page</a>,
  },
)

/**
 * Split in two so the vault-reading half never has to run without a vault.
 *
 * The reader for a shared page renders these same blocks with no notebook open,
 * and `useVaultIndex` throws there by design. Deciding that here — before any
 * hook that needs a vault — is what keeps the rule "`useVault` throws when
 * misused" intact instead of softening it for this one case.
 */
function PageEmbedBlock({ docId }: { docId: DocId }) {
  const vault = useOptionalVault()

  // The bundle holds one page. An embed inside it points at something that was
  // never sent.
  if (!vault) {
    return <Frame>This page embeds another page, which was not shared with it.</Frame>
  }

  return <VaultPageEmbed docId={docId} />
}

function VaultPageEmbed({ docId }: { docId: DocId }) {
  const chain = useContext(EmbedChainContext)
  const vault = useVault()
  const index = useVaultIndex()
  const navigate = useNavigate()

  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<string | null>(null)

  const summary = index.docs[docId]
  const looping = chain.includes(docId)
  const tooDeep = chain.length >= MAX_EMBED_DEPTH
  const loadable = Boolean(summary) && !looping && !tooDeep

  useEffect(() => {
    if (!loadable) return
    let cancelled = false

    vault
      .readDoc(docId)
      .then((loaded) => {
        if (!cancelled) setDoc(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
    }
  }, [vault, docId, loadable])

  if (!summary) {
    return <Frame>That page no longer exists.</Frame>
  }

  if (looping) {
    return (
      <Frame title={summary.title || UNTITLED} onOpen={() => navigate(docId)}>
        This page is already open further up, so showing it here would never end.
      </Frame>
    )
  }

  if (tooDeep) {
    return (
      <Frame title={summary.title || UNTITLED} onOpen={() => navigate(docId)}>
        Embedded pages stop after {MAX_EMBED_DEPTH} levels. Open it to read further.
      </Frame>
    )
  }

  if (error) {
    return <Frame title={summary.title || UNTITLED}>{error}</Frame>
  }

  return (
    <Frame title={summary.title || UNTITLED} onOpen={() => navigate(docId)}>
      {doc === null ? (
        <span className="sr-only">Opening the page…</span>
      ) : isCollection(doc.content) ? (
        // A database is a table with its own filters and sorts, and a copy of
        // it here would be a second set of controls acting on the same rows.
        // The link is the honest answer.
        <span>A database. Open it to see the table.</span>
      ) : (
        <EmbedChain docId={docId}>
          <ReadOnlyBlocks content={doc.content} />
        </EmbedChain>
      )}
    </Frame>
  )
}

/**
 * The border that says "this text belongs to another page".
 *
 * Without it, an embedded paragraph reads as part of the page you are on, and
 * a reader has no way to know which document they would be editing if they
 * started typing.
 */
function Frame({
  title,
  onOpen,
  children,
}: {
  title?: string
  onOpen?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="my-2 rounded-md border border-line bg-sunken/50 py-2 pr-2 pl-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-faint">
        <Icon name="page" className="size-3.5 shrink-0" />
        {onOpen ? (
          <Button size="sm" className="-mx-2 min-w-0 truncate" onClick={onOpen}>
            {title ?? 'Embedded page'}
          </Button>
        ) : (
          <span className="truncate">{title ?? 'Embedded page'}</span>
        )}
      </div>
      <div className="mt-1 text-sm text-ink-muted">{children}</div>
    </div>
  )
}
