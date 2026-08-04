import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { fr } from '@blocknote/core/locales'
import type { PartialBlock } from '@blocknote/core'
import '@blocknote/core/style.css'
import '@blocknote/mantine/style.css'
import '../design/blocknote.css'

import type { Doc, DocId, JsonValue } from '../../core/model/types'
import { UNTITLED } from '../../core/model/types'
import { ancestorsOf } from '../../core/model/tree'
import { useVault, useVaultIndex } from '../app/VaultProvider'
import { useAutosave, type SaveState } from './useAutosave'

/**
 * L'éditeur d'un document.
 *
 * Le chargement du contenu est asynchrone — il faut le déchiffrer — donc ce
 * composant sépare deux responsabilités : celui-ci attend le document, et
 * `LoadedEditor` ne s'affiche qu'une fois qu'il est là. La clé `doc.id`
 * garantit qu'ouvrir une autre page reconstruit l'éditeur au lieu de tenter de
 * remplacer son contenu sous le curseur.
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
  const editorHost = useRef<HTMLDivElement>(null)

  const { state, schedule } = useAutosave<DocPatch>((patch) => vault.saveDoc(doc.id, patch))

  // BlockNote refuse un document vide : il lui faut au moins un bloc. La clé
  // est omise plutôt que passée à `undefined` — avec
  // `exactOptionalPropertyTypes`, les deux ne sont pas la même chose — et il
  // crée alors lui-même le paragraphe initial.
  const initialContent = toInitialContent(doc.content)
  const editor = useCreateBlockNote(
    initialContent ? { initialContent, dictionary: fr } : { dictionary: fr },
  )

  const trail = ancestorsOf(index, doc.id)
  const title = index.docs[doc.id]?.title ?? doc.title

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
        <nav aria-label="Fil d'Ariane" className="min-w-0 truncate text-xs text-ink-faint">
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
              // Entrée depuis le titre fait descendre dans le corps du texte,
              // comme dans n'importe quel éditeur de document.
              if (event.key === 'Enter') {
                event.preventDefault()
                editorHost.current?.querySelector<HTMLElement>('[contenteditable=true]')?.focus()
              }
            }}
            placeholder={UNTITLED}
            aria-label="Titre de la page"
            className="w-full border-0 bg-transparent p-0 text-3xl font-semibold tracking-tight text-ink outline-none placeholder:text-ink-faint"
          />

          <div ref={editorHost} className="mt-6">
            <BlockNoteView
              // Les génériques de schéma de BlockNote ne satisfont pas
              // `exactOptionalPropertyTypes`, que le reste du projet garde
              // activé. La conversion est confinée à cette unique frontière
              // avec la bibliothèque plutôt que payée par tout le code.
              editor={editor as unknown as BlockNoteViewEditor}
              // Nos jetons pilotent déjà les couleurs des deux schémas ; ce
              // choix fixe n'évite qu'un recalcul inutile côté bibliothèque.
              theme="light"
              // Retiré du bundle : voir `emoji-mart-absent.ts`.
              emojiPicker={false}
              onChange={() => schedule({ content: editor.document as JsonValue })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function toInitialContent(content: JsonValue): PartialBlock[] | undefined {
  return Array.isArray(content) && content.length > 0 ? (content as PartialBlock[]) : undefined
}

const LABELS: Record<SaveState, string> = {
  saved: 'Enregistré',
  pending: 'Modifications en attente',
  saving: 'Enregistrement…',
  error: 'Échec de l’enregistrement',
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span
      // `polite` : l'information est utile mais ne doit pas interrompre la
      // frappe en cours pour l'annoncer.
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
        {/* Des blocs à la place du texte plutôt qu'un tourniquet : la page
            garde sa forme, et le passage au contenu réel ne fait pas sauter
            la mise en page. */}
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
