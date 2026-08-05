import { defaultBlockSpecs } from '@blocknote/core'

/**
 * A page has one first-level heading, and it is the page's name.
 *
 * In Nook the title lives in its own field, above the blocks and outside them —
 * so what the editor calls "Heading 1" is not the document's heading, it is the
 * first thing dividing it. On screen that is already true: the title is 36px and
 * the levels below it descend from 24px (see `design/blocknote.css`).
 *
 * What left the application said otherwise. The Markdown export writes the title
 * as `# Title` and then let a "Heading 1" out as `#` as well, so the file carried
 * two level-one headings and its outline read back to front — the same defect the
 * stylesheet had already fixed, surviving in the one place the note is read by
 * something other than Nook.
 *
 * So every heading of the body leaves one rung lower than it sits: `##`, `###`,
 * `####`. Nothing about the stored document changes — a heading is still level 1,
 * 2 or 3, `data-level` is untouched, and no page needs migrating. Only the door
 * is different.
 *
 * The inverse is deliberately not done. Pasting `## Something` still gives a
 * level-2 heading, because pasted Markdown is a note arriving from elsewhere,
 * where `#` really is that document's own title — promoting it would assume
 * every clipboard came from Nook.
 */

/** What a heading of the body is called once it is outside Nook. */
export function exportedHeadingLevel(level: number): number {
  return Math.min(Math.max(level, 1) + 1, 6)
}

/** What this module needs of a heading block. See `RemoteMediaEditor` in `DocEditor`. */
type HeadingBlock = { props: { level: number } }

/** What BlockNote's exporters expect back. `contentDOM` is filled in afterwards. */
type RenderedHTML = {
  dom: HTMLElement
  contentDOM?: HTMLElement
  childrenDOM?: HTMLElement
}

type ToExternalHTML = (block: HeadingBlock, editor: unknown, context: unknown) => RenderedHTML

const HEADING = defaultBlockSpecs.heading

/**
 * The same heading block, renamed on the way out.
 *
 * Only `toExternalHTML` is replaced, and it delegates to the original before
 * touching anything: that is the one method every route out of the editor goes
 * through — the Markdown export (`blocksToMarkdownLossy` builds external HTML and
 * reads the tag names back off it) and copying to the clipboard alike.
 *
 * Renaming the element the library produced, rather than building one, is what
 * keeps the default props and the `<details><summary>` shape of a collapsible
 * heading working without this file knowing they exist — and keeps them working
 * the day the library adds a third thing.
 */
export const HEADING_UNDER_TITLE = {
  ...HEADING,
  implementation: {
    ...HEADING.implementation,
    toExternalHTML: (block: HeadingBlock, editor: unknown, context: unknown): RenderedHTML => {
      const rendered = (HEADING.implementation.toExternalHTML as unknown as ToExternalHTML)(
        block,
        editor,
        context,
      )
      if (!rendered.contentDOM) return rendered

      const renamed = retag(rendered.contentDOM, `h${exportedHeadingLevel(block.props.level)}`)

      return {
        ...rendered,
        // A plain heading is its own content holder; a collapsible one hangs
        // under a `<details>` that must stay the outer element.
        dom: rendered.dom === rendered.contentDOM ? renamed : rendered.dom,
        contentDOM: renamed,
      }
    },
  },
}

/**
 * The same element under another tag name.
 *
 * Every attribute is carried over, not a chosen few: the exporter reads the
 * `data-*` it finds here back off the result, so dropping one would lose an
 * alignment or a colour rather than merely a level.
 *
 * `replaceWith` does nothing when the element has no parent, which is exactly
 * what a plain heading needs — it is the root of what was returned, and the
 * caller is handed the new element instead.
 */
function retag(element: HTMLElement, tagName: string): HTMLElement {
  const renamed = element.ownerDocument.createElement(tagName)

  for (const attribute of Array.from(element.attributes)) {
    renamed.setAttribute(attribute.name, attribute.value)
  }
  renamed.append(...Array.from(element.childNodes))
  element.replaceWith(renamed)

  return renamed
}
