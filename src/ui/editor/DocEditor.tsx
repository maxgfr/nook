import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { en } from '@blocknote/core/locales'
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type PartialBlock,
} from '@blocknote/core'
import '@blocknote/core/style.css'
import '@blocknote/mantine/style.css'
import '../design/blocknote.css'

import type { Doc, DocId, JsonValue } from '../../core/model/types'
import { UNTITLED } from '../../core/model/types'
import { ancestorsOf } from '../../core/model/tree'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { useAutosave, type SaveState } from './useAutosave'
import { Button } from '../design/Button'
import { Backlinks } from './Backlinks'
import { History } from './History'
import { createHighlighter, SUPPORTED_LANGUAGES } from './highlighter'
import { detectLanguage, looksLikeMarkdown } from '../../core/model/language'
import { CollectionView } from '../collection/CollectionView'
import { isCollection, type CollectionContent } from '../../core/model/collection'
import { useNavigate } from '../app/router'

/**
 * A document's editor.
 *
 * Loading the content is asynchronous — it has to be decrypted — so this
 * component splits two responsibilities: this one waits for the document, and
 * `LoadedEditor` only renders once it is there. The `doc.id` key guarantees
 * that opening another page rebuilds the editor rather than trying to swap its
 * content under the caret.
 */
export function DocEditor({ docId }: { docId: DocId }) {
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

  return <LoadedEditor key={doc.id} doc={doc} />
}

type DocPatch = { title: string; content: JsonValue }

/**
 * The default blocks, with a code block that knows how to colour itself.
 *
 * Highlighting is configured on the block **spec**, not as an editor option —
 * passing `codeBlock` to the editor is silently ignored, which is how a code
 * block can end up permanently grey with nothing in the console to say why.
 */
const CODE_AWARE_SCHEMA = BlockNoteSchema.create({
  // Same generics mismatch as `BlockNoteView` below: BlockNote's block specs
  // do not satisfy `exactOptionalPropertyTypes`, which the rest of the project
  // keeps on. The cast stays at this one boundary with the library.
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec({
      defaultLanguage: 'text',
      supportedLanguages: SUPPORTED_LANGUAGES,
      createHighlighter,
    }),
  } as unknown as NonNullable<Parameters<typeof BlockNoteSchema.create>[0]>['blockSpecs'],
})
export type { CollectionContent }
type BlockNoteViewEditor = ComponentProps<typeof BlockNoteView>['editor']

function LoadedEditor({ doc }: { doc: Doc }) {
  const vault = useVault()
  const index = useVaultIndex()
  const navigate = useNavigate()

  const { state, schedule } = useAutosave<DocPatch>((patch) => vault.saveDoc(doc.id, patch))

  const trail = ancestorsOf(index, doc.id)

  // The title field owns what it shows while the page is open.
  //
  // Binding it to the index instead looks like lag and is worse than lag: the
  // index only changes once the debounced save lands, so React rewrites the
  // old value into the input after every keystroke and the field appears
  // frozen. `LoadedEditor` is keyed by `doc.id`, so opening another page
  // remounts this with the right seed.
  const [title, setTitle] = useState(doc.title)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-print-hide
        className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-6"
      >
        <nav aria-label="Breadcrumbs" className="min-w-0 truncate text-xs text-ink-faint">
          {trail.map((ancestor) => (
            <span key={ancestor.id}>{ancestor.title || UNTITLED} / </span>
          ))}
          <span className="text-ink-muted">{title || UNTITLED}</span>
        </nav>
        <SaveIndicator state={state} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The generous bottom padding is not decoration. Menus in the editor
            open downwards, and at the end of a document there was nothing
            below the caret for them to open into, so the slash menu was cut
            off by the scroll container. Room to scroll past the last line is
            what every editor gives you, and it fixes this as a side effect. */}
        <div className="mx-auto w-full max-w-(--nook-measure) px-6 pt-10 pb-[60vh]">
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
            <RichTextBody
              content={doc.content}
              title={title}
              onChange={(content) => schedule({ content })}
            />
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
  content,
  title,
  onChange,
}: {
  content: JsonValue
  title: string
  onChange: (content: JsonValue) => void
}) {
  const vault = useVault()
  const editorHost = useRef<HTMLDivElement>(null)

  // BlockNote refuses an empty document: it needs at least one block. The key
  // is omitted rather than passed as `undefined` — with
  // `exactOptionalPropertyTypes`, the two are not the same thing — and it then
  // creates the initial paragraph itself.
  const initialContent = toInitialContent(content)
  const editor = useCreateBlockNote({
    ...(initialContent ? { initialContent } : {}),
    dictionary: en,
    schema: CODE_AWARE_SCHEMA,
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
    /** Turns a stored reference back into something the browser can display. */
    resolveFileUrl: async (url: string) => {
      if (!url.startsWith('nook:')) return url
      const blob = await vault.readBlob(url.slice('nook:'.length))
      if (!blob) return url
      return URL.createObjectURL(
        new Blob([new Uint8Array(blob.bytes)], { type: blob.type || 'application/octet-stream' }),
      )
    },
  })

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
      <div data-print-hide className="mb-1 flex justify-end">
        <Button size="sm" onClick={() => downloadMarkdown(title, editor.blocksToMarkdownLossy())}>
          Export as Markdown
        </Button>
      </div>
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
          onChange(editor.document as JsonValue)
        }}
      />
    </div>
  )
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

/**
 * Hands a Markdown file to the browser without touching the network.
 *
 * The conversion is lossy by name and by nature: anything Markdown cannot
 * express — a database, a colour — does not survive. That is the right trade
 * for a format whose whole point is being readable anywhere.
 */
function downloadMarkdown(title: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${(title || UNTITLED).replaceAll(/[^\w.-]+/gu, '-')}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function toInitialContent(content: JsonValue): PartialBlock[] | undefined {
  return Array.isArray(content) && content.length > 0 ? (content as PartialBlock[]) : undefined
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
