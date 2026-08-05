import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react'
import { en } from '@blocknote/core/locales'
import { filterSuggestionItems, type PartialBlock } from '@blocknote/core'

import type { Doc, DocId, JsonValue } from '../../core/model/types'
import { MINUTE_MS, UNTITLED } from '../../core/model/types'
import { readSnapshotPolicy } from '../app/snapshots'
import { ancestorsOf } from '../../core/model/tree'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { useAutosave, type SaveState } from './useAutosave'
import { Button, IconButton } from '../design/Button'
import { Icon } from '../design/Icon'
import { Backlinks } from './Backlinks'
import { History } from './History'
import { detectLanguage, looksLikeMarkdown } from '../../core/model/language'
import { CollectionView } from '../collection/CollectionView'
import { isCollection, type CollectionContent } from '../../core/model/collection'
import { useNavigate } from '../app/router'
import { classifyUrl, isLocalUrl } from '../../core/policy'
import { NOOK_SCHEMA, useResolveVaultFile, type BlockNoteViewEditor } from './schema'
import { EmbedChain } from './PageEmbed'
import { PagePicker } from './PagePicker'
import { ShareDialog } from '../share/ShareDialog'
import { download, fileNameFrom } from '../design/download'

/**
 * A document's editor.
 *
 * Loading the content is asynchronous — it has to be decrypted — so this
 * component splits two responsibilities: this one waits for the document, and
 * `LoadedEditor` only renders once it is there. The `doc.id` key guarantees
 * that opening another page rebuilds the editor rather than trying to swap its
 * content under the caret.
 */
export function DocEditor({
  docId,
  onOpenPages,
}: {
  docId: DocId
  /** Opens the page list, which is a drawer below `md`. */
  onOpenPages: () => void
}) {
  const vault = useVault()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)

    vault
      .readDoc(docId)
      .then((loaded) => {
        if (!cancelled) setDoc(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)))
      })

    return () => {
      cancelled = true
    }
  }, [vault, docId])

  if (error) {
    return (
      <Centered>
        <p className="text-sm text-danger">{error.message}</p>
      </Centered>
    )
  }
  if (!doc) return <EditorSkeleton />

  return <LoadedEditor key={doc.id} doc={doc} onOpenPages={onOpenPages} />
}

type DocPatch = { title: string; content: JsonValue }

export type { CollectionContent }

function LoadedEditor({ doc, onOpenPages }: { doc: Doc; onOpenPages: () => void }) {
  const vault = useVault()
  const index = useVaultIndex()
  const navigate = useNavigate()

  // The policy is read at each save rather than captured once, so changing it
  // in Settings applies from the next keystroke instead of the next reload.
  const { state, schedule, flush } = useAutosave<DocPatch>((patch) => {
    const policy = readSnapshotPolicy()
    return vault.saveDoc(doc.id, patch, {
      snapshot: policy.automatic ? 'auto' : 'never',
      intervalMs: policy.everyMinutes * MINUTE_MS,
    })
  })

  const trail = ancestorsOf(index, doc.id)

  // The title field owns what it shows while the page is open.
  //
  // Binding it to the index instead looks like lag and is worse than lag: the
  // index only changes once the debounced save lands, so React rewrites the
  // old value into the input after every keystroke and the field appears
  // frozen. `LoadedEditor` is keyed by `doc.id`, so opening another page
  // remounts this with the right seed.
  const [title, setTitle] = useState(doc.title)
  const [shareOpen, setShareOpen] = useState(false)

  /**
   * The editor lives in `RichTextBody`, and the button that exports it lives up
   * here in the header beside the other page actions.
   *
   * A ref rather than lifting the whole editor into this component: creating it
   * here would make a database page pay for building a ProseMirror instance it
   * never shows, which is the split `RichTextBody` exists to keep.
   */
  const exportMarkdown = useRef<(() => void) | null>(null)
  // Stable, so the body re-registers when the title changes and not on every
  // render of this component.
  const registerExport = useCallback((run: () => void) => {
    exportMarkdown.current = run
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-print-hide
        className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 md:gap-4 md:px-6"
      >
        <div className="flex min-w-0 items-center gap-2">
          <IconButton label="Pages" size="sm" className="md:hidden" onClick={onOpenPages}>
            <Icon name="sidebar" />
          </IconButton>
          {/*
            The trail is the first thing to go when the row is tight: it says
            where you are, and on a phone the page's own title is already the
            largest thing on the screen underneath.
          */}
          <nav aria-label="Breadcrumbs" className="min-w-0 truncate text-xs text-ink-faint">
            {trail.map((ancestor) => (
              <span key={ancestor.id} className="max-sm:hidden">
                {ancestor.title || UNTITLED} /{' '}
              </span>
            ))}
            <span className="text-ink-muted">{title || UNTITLED}</span>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SaveIndicator state={state} />
          <SnapshotButton docId={doc.id} flush={flush} />
          {/*
            Only for prose. A database has no Markdown to export — the table,
            its filters and its views have no equivalent — and a button that
            produces an empty file is worse than no button.
          */}
          {!isCollection(doc.content) && (
            <Button
              size="sm"
              title="Export this page as Markdown"
              onClick={() => exportMarkdown.current?.()}
            >
              Export
            </Button>
          )}
          <Button size="sm" onClick={() => setShareOpen(true)}>
            Share
          </Button>
        </div>
        <ShareDialog docId={doc.id} open={shareOpen} onClose={() => setShareOpen(false)} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The generous bottom padding is not decoration. Menus in the editor
            open downwards, and at the end of a document there was nothing
            below the caret for them to open into, so the slash menu was cut
            off by the scroll container. Room to scroll past the last line is
            what every editor gives you, and it fixes this as a side effect. */}
        <div className="mx-auto w-full max-w-(--nook-measure) px-4 pt-8 pb-[60vh] md:px-6 md:pt-10">
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              schedule({ title: event.target.value })
            }}
            placeholder={UNTITLED}
            aria-label="Page title"
            className="w-full border-0 bg-transparent p-0 text-3xl font-semibold tracking-tight text-ink outline-none placeholder:text-ink-faint"
          />

          {isCollection(doc.content) ? (
            <CollectionBody
              initial={doc.content}
              onChange={(next) => schedule({ content: next as unknown as JsonValue })}
            />
          ) : (
            // Seeds the chain of embedded pages with this one, so a page that
            // embeds itself — however long the way round — is caught rather
            // than recursed into.
            <EmbedChain docId={doc.id}>
              <RichTextBody
                docId={doc.id}
                content={doc.content}
                title={title}
                onChange={(content) => schedule({ content })}
                registerExport={registerExport}
              />
            </EmbedChain>
          )}

          <Backlinks docId={doc.id} onOpen={navigate} />
          <History docId={doc.id} />
        </div>
      </div>
    </div>
  )
}

/**
 * A database body.
 *
 * It owns its rows while the page is open. The saved copy is the destination,
 * not the source: reading back from it would mean every keystroke waited for a
 * debounce, an encryption and a round trip through IndexedDB before appearing
 * — which looks exactly like a table that has stopped responding.
 *
 * The rich-text editor never needed this because ProseMirror already keeps its
 * own document; this is the same arrangement, made explicit.
 */
function CollectionBody({
  initial,
  onChange,
}: {
  initial: CollectionContent
  onChange: (next: CollectionContent) => void
}) {
  const [collection, setCollection] = useState(initial)

  return (
    <CollectionView
      collection={collection}
      onChange={(next) => {
        setCollection(next)
        onChange(next)
      }}
    />
  )
}

/**
 * The prose body.
 *
 * Split out so the editor's hooks only run for pages that actually have prose:
 * a database page must not pay for building a ProseMirror instance it will
 * never show.
 */
function RichTextBody({
  docId,
  content,
  title,
  onChange,
  registerExport,
}: {
  docId: DocId
  content: JsonValue
  title: string
  onChange: (content: JsonValue) => void
  /** Hands the header a way to export what this editor is holding. */
  registerExport: (run: () => void) => void
}) {
  const vault = useVault()
  const editorHost = useRef<HTMLDivElement>(null)
  const resolveFileUrl = useResolveVaultFile()
  const [pickerOpen, setPickerOpen] = useState(false)

  // BlockNote refuses an empty document: it needs at least one block. The key
  // is omitted rather than passed as `undefined` — with
  // `exactOptionalPropertyTypes`, the two are not the same thing — and it then
  // creates the initial paragraph itself.
  const initialContent = toInitialContent(content)
  const editor = useCreateBlockNote({
    ...(initialContent ? { initialContent } : {}),
    dictionary: en,
    schema: NOOK_SCHEMA,
    /**
     * Pictures are stored in the vault, encrypted like the notes.
     *
     * Despite the name, nothing is uploaded: the bytes are read in the tab and
     * written straight to IndexedDB. A `nook:` reference is returned rather
     * than a `blob:` URL because blob URLs die with the page — a note would
     * show its picture until the first reload and a broken frame ever after.
     */
    uploadFile: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const id = await vault.putBlob({ name: file.name, type: file.type, bytes })
      return `nook:${id}`
    },
    resolveFileUrl,
  })

  /**
   * Hands the header something to call.
   *
   * Re-registered when the title changes, because the title leads the exported
   * file and is held by the component above — a closure captured once would
   * export the name the page had when it was opened.
   */
  useEffect(() => {
    registerExport(() => downloadMarkdown(title, editor.blocksToMarkdownLossy()))
  }, [registerExport, title, editor])

  return (
    <div
      ref={editorHost}
      className="mt-6"
      /**
       * Markdown pasted as plain text becomes real blocks.
       *
       * The editor already handles lists and emphasis, but a pasted `## Title`
       * stayed literal — the common case of moving a note in from somewhere
       * else. Parsing it here fixes that.
       *
       * Only when the clipboard carries no HTML: HTML says exactly what the
       * content is, and replacing that with a guess would be a downgrade.
       */
      onPasteCapture={(event) => {
        const clipboard = event.clipboardData
        const text = clipboard?.getData('text/plain') ?? ''
        if (clipboard?.getData('text/html') || !looksLikeMarkdown(text)) return

        event.preventDefault()
        event.stopPropagation()
        const blocks = editor.tryParseMarkdownToBlocks(text)
        const { block } = editor.getTextCursorPosition()
        editor.replaceBlocks([block], blocks)
      }}
    >
      <BlockNoteView
        // BlockNote's schema generics do not satisfy
        // `exactOptionalPropertyTypes`, which the rest of the project keeps
        // enabled. The cast is confined to this single boundary with the
        // library rather than paid for by all the code.
        editor={editor as unknown as BlockNoteViewEditor}
        // Our tokens already drive the colours of both schemes; this fixed
        // choice only avoids a pointless recalculation inside the library.
        theme="light"
        // Removed from the bundle: see `emoji-mart-absent.ts`.
        emojiPicker={false}
        onChange={() => {
          applyDetectedLanguages(editor)
          normalizeRemoteMedia(editor as unknown as RemoteMediaEditor)
          onChange(editor.document as JsonValue)
        }}
        // Replaced by our own, below, so that "Embed a page" can sit among the
        // built-in items instead of in a second menu nobody would look in.
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                // Same boundary cast as everywhere the editor is handed to the
                // library: the schema cast above costs it its own generics.
                ...getDefaultReactSlashMenuItems(editor as unknown as SlashMenuEditor).filter(
                  /*
                   * The emoji picker is not in this build — its library fetches
                   * its data and its images from a CDN, so it is replaced at
                   * build time (see `emoji-mart-absent.ts`). The menu entry
                   * survived that removal and opened nothing at all, which is
                   * precisely the "silently empty menu, the worst of both
                   * worlds" the removal existed to avoid.
                   *
                   * Matched against the same dictionary the editor renders
                   * from, so a translation cannot make the filter miss.
                   */
                  (item) => item.title !== en.slash_menu.emoji.title,
                ),
                {
                  title: 'Embed a page',
                  subtext: 'Show another page of this notebook here, read-only',
                  group: 'Basic blocks',
                  aliases: ['embed', 'transclude', 'include', 'page'],
                  onItemClick: () => setPickerOpen(true),
                },
              ],
              query,
            )
          }
        />
      </BlockNoteView>

      <PagePicker
        open={pickerOpen}
        exclude={docId}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => insertPageEmbed(editor as unknown as PageEmbedEditor, picked)}
      />
    </div>
  )
}

type SlashMenuEditor = Parameters<typeof getDefaultReactSlashMenuItems>[0]

/** What inserting an embed needs of the editor. See `RemoteMediaEditor`. */
type PageEmbedEditor = {
  getTextCursorPosition: () => { block: { id: string } }
  insertBlocks: (
    blocks: { type: 'pageEmbed'; props: { docId: string } }[],
    reference: { id: string },
    placement: 'before' | 'after',
  ) => void
}

/**
 * Puts the chosen page after the block the caret is in.
 *
 * After rather than in place: the `/` was typed in a paragraph that may hold
 * other text, and replacing it would delete something nobody asked to lose.
 */
function insertPageEmbed(editor: PageEmbedEditor, docId: DocId): void {
  const { block } = editor.getTextCursorPosition()
  editor.insertBlocks([{ type: 'pageEmbed', props: { docId } }], block, 'after')
}

/**
 * Gives a code block a language once it has enough text to guess from.
 *
 * Only blocks still on the default are touched. Overriding a language someone
 * picked would be a heuristic contradicting an instruction, which is the one
 * thing a heuristic must never do.
 */
function applyDetectedLanguages(editor: {
  document: unknown
  updateBlock: (id: string, update: { props: { language: string } }) => void
}): void {
  for (const block of editor.document as {
    type?: string
    id?: string
    props?: { language?: string }
    content?: { text?: string }[]
  }[]) {
    if (block.type !== 'codeBlock' || !block.id) continue
    // Empty and `text` both mean "nobody chose". The ``` shortcut leaves the
    // language empty, while the block's own default is `text`, and only a
    // language someone picked is off limits.
    const current = block.props?.language ?? ''
    if (current !== '' && current !== 'text') continue

    const text = (block.content ?? []).map((part) => part.text ?? '').join('')
    const detected = detectLanguage(text)
    if (detected) editor.updateBlock(block.id, { props: { language: detected } })
  }
}

/** The native blocks that hold an address to something the browser will fetch. */
const MEDIA_BLOCKS = new Set(['image', 'video', 'audio', 'file'])

/**
 * What this pass needs of the editor.
 *
 * Written out rather than taken from BlockNote because the `as unknown as` on
 * `CODE_AWARE_SCHEMA` above costs the editor its knowledge of the custom
 * blocks: as far as its own types are concerned, `webEmbed` does not exist. The
 * cast is confined to the one call, in the same spirit as the one on
 * `BlockNoteView`, rather than paid for by every line that touches a block.
 */
type RemoteMediaEditor = {
  document: unknown
  updateBlock: (
    id: string,
    update: { type: 'webEmbed'; props: { url: string; kind: 'image' | 'frame' | 'link' } },
  ) => void
}

/**
 * Moves a media block pointing off this machine into `webEmbed`.
 *
 * BlockNote's own media blocks take a URL, and under this project's policy a
 * remote one simply fails to load: a broken frame, nothing in the interface to
 * say why, and no way to tell it apart from a picture that has been deleted.
 * Converting the block is what turns that dead end into a statement of what is
 * there and a choice about it.
 *
 * Runs on every change, like the language pass above, and is idempotent for the
 * same reason: the converted block is no longer one of `MEDIA_BLOCKS`, and a
 * `nook:` address is local, so neither can be picked up a second time.
 */
function normalizeRemoteMedia(editor: RemoteMediaEditor): void {
  for (const block of editor.document as {
    type?: string
    id?: string
    props?: { url?: string }
  }[]) {
    if (!block.id || !block.type || !MEDIA_BLOCKS.has(block.type)) continue

    const url = block.props?.url ?? ''
    if (url === '' || isLocalUrl(url)) continue

    editor.updateBlock(block.id, {
      type: 'webEmbed',
      props: { url, kind: remoteKind(block.type, url) },
    })
  }
}

/**
 * What a remote address should be treated as.
 *
 * The address is asked first, because a provider link is a player whichever
 * block someone happened to paste it into. Failing that the *block* is asked
 * before the file extension: an image block holds a picture even when its
 * address ends in nothing recognisable, which is true of most image URLs that
 * come out of a CDN.
 */
function remoteKind(blockType: string, url: string): 'image' | 'frame' | 'link' {
  const classified = classifyUrl(url)
  if (classified === 'frame') return 'frame'
  return blockType === 'image' || classified === 'image' ? 'image' : 'link'
}

/**
 * Hands a Markdown file to the browser without touching the network.
 *
 * The conversion is lossy by name and by nature: anything Markdown cannot
 * express — a database, a colour — does not survive. That is the right trade
 * for a format whose whole point is being readable anywhere.
 *
 * The title leads the file as a level-1 heading. In Nook it lives in its own
 * field, outside the blocks, so exporting the blocks alone produced a document
 * that had lost its name everywhere except the filename — and a filename does
 * not survive being pasted somewhere else.
 *
 * It is the *only* level-1 heading in the file. The headings of the body come
 * out one rung lower than they sit — a "Heading 1" writes `##` — because they
 * divide the page rather than name it. That happens in the block itself; see
 * `headings.ts` for why the door is the right place for it.
 */
function downloadMarkdown(title: string, markdown: string): void {
  download(
    fileNameFrom(title, UNTITLED, '.md'),
    `# ${title || UNTITLED}\n\n${markdown}`,
    'text/markdown',
  )
}

function toInitialContent(content: JsonValue): PartialBlock[] | undefined {
  return Array.isArray(content) && content.length > 0 ? (content as PartialBlock[]) : undefined
}

/**
 * Keeps this version, now.
 *
 * The automatic rule can only ever guess which moments matter; this is the one
 * moment somebody chose. It flushes the pending autosave first, because the
 * text worth keeping is the text on the screen — snapshotting the last saved
 * version instead would quietly keep something slightly older than what was
 * asked for.
 */
function SnapshotButton({ docId, flush }: { docId: DocId; flush: () => Promise<void> }) {
  const vault = useVault()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  // The timer that clears the message has to be cancellable. Without this, the
  // countdown started by one press wipes the answer to the *next* one — so
  // pressing twice in quick succession showed nothing the second time, which
  // reads as a button that stopped working.
  const clearing = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(clearing.current ?? undefined), [])

  const say = (message: string) => {
    setSaid(message)
    if (clearing.current !== null) clearTimeout(clearing.current)
    clearing.current = setTimeout(() => setSaid(null), 4000)
  }

  const take = async () => {
    setBusy(true)
    setSaid(null)
    try {
      await flush()
      say((await vault.snapshot(docId)) ? 'Kept' : 'Nothing new to keep')
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {said && (
        <span aria-live="polite" className="text-xs text-ink-faint">
          {said}
        </span>
      )}
      <Button size="sm" disabled={busy} onClick={() => void take()} title="Keep this version">
        {busy ? 'Keeping…' : 'Snapshot'}
      </Button>
    </>
  )
}

const LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Could not save',
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span
      // `polite`: the information is useful but must not interrupt the
      // typing in progress in order to announce it.
      aria-live="polite"
      className={`shrink-0 text-xs ${state === 'error' ? 'text-danger' : 'text-ink-faint'}`}
    >
      {LABELS[state]}
    </span>
  )
}

function EditorSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <div className="h-11 shrink-0 border-b border-line" />
      <div className="mx-auto w-full max-w-(--nook-measure) px-6 py-10">
        {/*
Blocks in place of text rather than a spinner: the page
            keeps its shape, and switching to the real content does not make
            the layout jump. 
*/}
        <div className="h-9 w-2/3 rounded-sm bg-hover" />
        <div className="mt-8 space-y-3">
          <div className="h-4 w-full rounded-sm bg-hover" />
          <div className="h-4 w-11/12 rounded-sm bg-hover" />
          <div className="h-4 w-4/6 rounded-sm bg-hover" />
        </div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-center">{children}</div>
}
