/**
 * Syntax highlighting, bundled rather than fetched.
 *
 * Shiki normally fetches grammars from a CDN. Here each one is a dynamic
 * import that the bundler resolves to a local chunk, so they ship with the
 * application and the service worker precaches them — a code block that only
 * colours itself when online would be a strange thing in an offline notebook.
 *
 * They stay in separate chunks rather than one: bundled together they pushed
 * the editor past three megabytes, over the size the service worker will
 * precache, so the offline promise broke on the very thing meant to preserve
 * it. Split, each grammar is fetched from cache the first time a block needs
 * it.
 *
 * The language list is deliberately finite. All two hundred grammars would add
 * megabytes to cover languages nobody writes in a note; these are the ones a
 * note is actually likely to contain.
 */

import { createHighlighterCore, type HighlighterGeneric } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import light from 'shiki/themes/github-light-default.mjs'
import dark from 'shiki/themes/github-dark-default.mjs'

/** Display names, and what the block's dropdown offers. */
export const SUPPORTED_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: 'Plain text' },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  tsx: { name: 'TSX', aliases: ['jsx'] },
  python: { name: 'Python', aliases: ['py'] },
  rust: { name: 'Rust', aliases: ['rs'] },
  go: { name: 'Go' },
  java: { name: 'Java' },
  ruby: { name: 'Ruby', aliases: ['rb'] },
  php: { name: 'PHP' },
  shell: { name: 'Shell', aliases: ['bash', 'sh', 'zsh', 'shellscript'] },
  sql: { name: 'SQL' },
  json: { name: 'JSON' },
  yaml: { name: 'YAML', aliases: ['yml'] },
  html: { name: 'HTML' },
  css: { name: 'CSS' },
  markdown: { name: 'Markdown', aliases: ['md'] },
}

let pending: Promise<HighlighterGeneric<never, never>> | undefined

/**
 * Built once, on first use.
 *
 * Compiling seventeen grammars costs a beat, and a page with no code in it
 * should not pay it. The promise is cached so a document full of code blocks
 * builds the highlighter a single time.
 */
export function createHighlighter(): Promise<HighlighterGeneric<never, never>> {
  pending ??= createHighlighterCore({
    themes: [light, dark],
    langs: [
      import('shiki/langs/css.mjs'),
      import('shiki/langs/go.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/java.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/langs/php.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/ruby.mjs'),
      import('shiki/langs/rust.mjs'),
      import('shiki/langs/shellscript.mjs'),
      import('shiki/langs/sql.mjs'),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/yaml.mjs'),
    ],
    // The JavaScript engine rather than the WebAssembly one: it needs no
    // second wasm module, and the difference in speed is invisible on a
    // snippet that fits on a screen.
    engine: createJavaScriptRegexEngine(),
  }) as Promise<HighlighterGeneric<never, never>>
  return pending
}
