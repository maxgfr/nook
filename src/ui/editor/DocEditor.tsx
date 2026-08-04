import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { en } from '@blocknote/core/locales'
import type { PartialBlock } from '@blocknote/core'
import '@blocknote/core/style.css'
import '@blocknote/mantine/style.css'
import '../design/blocknote.css'

import type { Doc, DocId, JsonValue } from '../../core/model/types'
import { UNTITLED } from '../../core/model/types'
import { ancestorsOf } from '../../core/model/tree'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { useAutosave, type SaveState } from './useAutosave'
import { Backlinks } from './Backlinks'
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
type BlockNoteViewEditor = ComponentProps<typeof BlockNoteView>['editor']

function LoadedEditor({ doc }: { doc: Doc }) {
  const vault = useVault()
  const index = useVaultIndex()
  const navigate = useNavigate()
  const editorHost = useRef<HTMLDivElement>(null)

  const { state, schedule } = useAutosave<DocPatch>((patch) => vault.saveDoc(doc.id, patch))

  // BlockNote refuses an empty document: it needs at least one block. The key
  // is omitted rather than passed as `undefined` — with
  // `exactOptionalPropertyTypes`, the two are not the same thing — and it
  // then creates the initial paragraph itself.
  const initialContent = toInitialContent(doc.content)
  const editor = useCreateBlockNote(
    initialContent ? { initialContent, dictionary: en } : { dictionary: en },
  )

  const trail = ancestorsOf(index, doc.id)
  const title = index.docs[doc.id]?.title ?? doc.title

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
        <nav aria-label="Breadcrumbs" className="min-w-0 truncate text-xs text-ink-faint">
          {trail.map((ancestor) => (
            <span key={ancestor.id}>{ancestor.title || UNTITLED} / </span>
          ))}
          <span className="text-ink-muted">{title || UNTITLED}</span>
        </nav>
        <SaveIndicator state={state} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-(--nook-measure) px-6 py-10">
          <input
            value={title}
            onChange={(event) => schedule({ title: event.target.value })}
            onKeyDown={(event) => {
              // Enter from the title moves down into the body,
              // as in any document editor.
              if (event.key === 'Enter') {
                event.preventDefault()
                editorHost.current?.querySelector<HTMLElement>('[contenteditable=true]')?.focus()
              }
            }}
            placeholder={UNTITLED}
            aria-label="Page title"
            className="w-full border-0 bg-transparent p-0 text-3xl font-semibold tracking-tight text-ink outline-none placeholder:text-ink-faint"
          />

          <div ref={editorHost} className="mt-6">
            <BlockNoteView
              // BlockNote's schema generics do not satisfy
              // `exactOptionalPropertyTypes`, which the rest of the project keeps
              // enabled. The cast is confined to this single boundary
              // with the library rather than paid for by all the code.
              editor={editor as unknown as BlockNoteViewEditor}
              // Our tokens already drive the colours of both schemes; this
              // fixed choice only avoids a pointless recalculation inside the library.
              theme="light"
              // Removed from the bundle: see `emoji-mart-absent.ts`.
              emojiPicker={false}
              onChange={() => schedule({ content: editor.document as JsonValue })}
            />
          </div>

          <Backlinks docId={doc.id} onOpen={navigate} />
        </div>
      </div>
    </div>
  )
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
