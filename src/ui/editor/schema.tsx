import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from '@blocknote/core'
import { en } from '@blocknote/core/locales'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import type { ComponentProps } from 'react'

/*
 * The editor's own styling, and ours over it.
 *
 * Imported here rather than in `DocEditor` because this module is where blocks
 * are rendered from — by the editor, by an embedded page, and by the reader for
 * a page somebody shared. Hanging the stylesheets off the editor alone meant the
 * reader, which is a separate lazily-loaded chunk, drew real `h1`…`h6` with no
 * BlockNote stylesheet at all: a shared page fell back to the browser's default
 * heading sizes, a different and larger hierarchy than the one it was written
 * in, underneath a 36px title.
 *
 * Ours comes last, and has to: it re-anchors the library's variables.
 */
import '@blocknote/core/style.css'
import '@blocknote/mantine/style.css'
import '../design/blocknote.css'

import type { JsonValue } from '../../core/model/types'
import { useOptionalVault } from '../app/VaultProvider'
import { createHighlighter, SUPPORTED_LANGUAGES } from './highlighter'
import { HEADING_UNDER_TITLE } from './headings'
import { createPageEmbedSpec } from './PageEmbed'
import { createWebEmbedSpec } from './WebEmbed'

/**
 * The blocks a Nook page is made of, and how to render one read-only.
 *
 * This lives in its own module because the structure is genuinely recursive: a
 * page can embed another page, so the schema contains a block whose renderer
 * builds an editor that uses the schema. `PageEmbed` therefore imports
 * `ReadOnlyBlocks` from here while this module imports `createPageEmbedSpec`
 * from there.
 *
 * That cycle is safe, and it is worth saying exactly why rather than leaving
 * the next reader to work it out: `PageEmbed` only *calls* `ReadOnlyBlocks`
 * during a React render, never while its module is being evaluated. By the time
 * anything renders, both modules have finished loading. Were `PageEmbed` to
 * touch `ReadOnlyBlocks` at the top level, this would break at import time.
 */

export type BlockNoteViewEditor = ComponentProps<typeof BlockNoteView>['editor']

/**
 * The default blocks, with a code block that knows how to colour itself.
 *
 * Highlighting is configured on the block **spec**, not as an editor option —
 * passing `codeBlock` to the editor is silently ignored, which is how a code
 * block can end up permanently grey with nothing in the console to say why.
 */
export const NOOK_SCHEMA = BlockNoteSchema.create({
  // BlockNote's block specs do not satisfy `exactOptionalPropertyTypes`, which
  // the rest of the project keeps on. The cast stays at this one boundary with
  // the library. Its cost is that the editor loses the type-level knowledge of
  // the custom blocks, which is why the few calls that name `webEmbed` or
  // `pageEmbed` cast again at the call site.
  blockSpecs: {
    ...defaultBlockSpecs,
    // The library's heading, renamed one rung lower on the way out so the page
    // title stays the only first-level heading of an exported file.
    heading: HEADING_UNDER_TITLE,
    codeBlock: createCodeBlockSpec({
      defaultLanguage: 'text',
      supportedLanguages: SUPPORTED_LANGUAGES,
      createHighlighter,
    }),
    // Anything hosted elsewhere. Never inserted by hand — `normalizeRemoteMedia`
    // in `DocEditor` moves a native media block here as soon as its address
    // turns out to point off this machine.
    webEmbed: createWebEmbedSpec(),
    // Another page of this notebook, shown in place. Entirely local.
    pageEmbed: createPageEmbedSpec(),
  } as unknown as NonNullable<Parameters<typeof BlockNoteSchema.create>[0]>['blockSpecs'],
})

/**
 * Turns a stored `nook:` reference back into something the browser can display.
 *
 * Shared by the editor and by every embedded page, so a picture inside an
 * embedded page resolves exactly as it does on its own page. Returns the
 * address untouched when there is no vault — the reader for a shared page has
 * none, and serves the bundle's own files instead.
 */
export function useResolveVaultFile(): (url: string) => Promise<string> {
  const vault = useOptionalVault()

  return async (url: string) => {
    if (!url.startsWith('nook:') || !vault) return url
    const blob = await vault.readBlob(url.slice('nook:'.length))
    if (!blob) return url
    return URL.createObjectURL(
      new Blob([new Uint8Array(blob.bytes)], { type: blob.type || 'application/octet-stream' }),
    )
  }
}

/**
 * A page's content, rendered but not editable.
 *
 * Uses the editor rather than a separate renderer written by hand. A second
 * renderer would have to be taught every block the first one knows, and would
 * be wrong about the next one added — the failure would be silent, and would
 * show up as an embedded page quietly missing a paragraph.
 */
export function ReadOnlyBlocks({
  content,
  resolveFile,
}: {
  content: JsonValue
  /**
   * Where the files come from, when they do not come from the vault. The
   * reader for a shared page serves them out of the bundle it was handed.
   */
  resolveFile?: (url: string) => Promise<string>
}) {
  const fromVault = useResolveVaultFile()
  const initialContent = Array.isArray(content) && content.length > 0 ? content : undefined

  const editor = useCreateBlockNote({
    ...(initialContent ? { initialContent: initialContent as never } : {}),
    dictionary: en,
    schema: NOOK_SCHEMA,
    resolveFileUrl: resolveFile ?? fromVault,
  })

  return (
    <BlockNoteView
      editor={editor as unknown as BlockNoteViewEditor}
      editable={false}
      theme="light"
      emojiPicker={false}
      sideMenu={false}
      formattingToolbar={false}
      slashMenu={false}
    />
  )
}
