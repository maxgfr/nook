/**
 * Guessing what language a code block is written in.
 *
 * Nobody wants to open a dropdown after pasting a snippet, so the block picks
 * a language itself. The guess is only ever applied to a block still on the
 * default, never over a choice someone made — a heuristic that overrides an
 * explicit decision is worse than no heuristic.
 *
 * The method is deliberately blunt: score each candidate on markers that are
 * rare outside it, and refuse to answer when nothing stands out. A wrong
 * guess costs more than none, because the wrong grammar mangles the colours
 * of the whole block.
 */

export type LanguageId =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'ruby'
  | 'php'
  | 'shell'
  | 'sql'
  | 'json'
  | 'yaml'
  | 'html'
  | 'css'
  | 'markdown'

type Rule = { readonly language: LanguageId; readonly pattern: RegExp; readonly weight: number }

/**
 * Markers, weighted by how much they narrow things down.
 *
 * A weight of 3 means "practically settles it" (`#!/bin/bash`, `<?php`), 2
 * means "strongly suggests", 1 means "leans". Several weak signals can add up
 * to a confident answer; one weak signal never does.
 */
const RULES: readonly Rule[] = [
  { language: 'shell', pattern: /^#!.*\b(bash|sh|zsh)\b/m, weight: 3 },
  { language: 'php', pattern: /<\?php\b/, weight: 3 },
  { language: 'python', pattern: /^\s*def\s+\w+\s*\(.*\)\s*:/m, weight: 3 },
  { language: 'python', pattern: /^\s*(from\s+[\w.]+\s+)?import\s+\w+$/m, weight: 2 },
  { language: 'python', pattern: /^\s*(elif|print\()/m, weight: 2 },
  { language: 'rust', pattern: /\bfn\s+\w+\s*(<[^>]*>)?\s*\(/, weight: 3 },
  { language: 'rust', pattern: /\blet\s+mut\b|\bimpl\b|::<|&str\b/, weight: 2 },
  { language: 'go', pattern: /^\s*func\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/m, weight: 3 },
  { language: 'go', pattern: /\bpackage\s+main\b|:=|\bfmt\./, weight: 2 },
  {
    language: 'java',
    pattern: /\b(public|private)\s+(static\s+)?(final\s+)?(class|void|int)\b/,
    weight: 3,
  },
  { language: 'ruby', pattern: /^\s*(def\s+\w+.*\n[\s\S]*?^\s*end\b|require\s+['"])/m, weight: 3 },
  { language: 'ruby', pattern: /\bputs\b|\bdo\s*\|\w+\|/, weight: 2 },
  { language: 'sql', pattern: /\bselect\b[\s\S]*\bfrom\b/i, weight: 3 },
  { language: 'sql', pattern: /\b(insert\s+into|create\s+table|alter\s+table)\b/i, weight: 3 },
  { language: 'typescript', pattern: /\b(interface|type)\s+\w+\s*(<[^>]*>)?\s*[={]/, weight: 3 },
  // A typed parameter or return settles it: valid JavaScript cannot carry one.
  { language: 'typescript', pattern: /\(\s*\w+\s*:\s*\w+|\)\s*:\s*[\w<>[\]|]+\s*[{=]/, weight: 3 },
  {
    language: 'typescript',
    pattern: /:\s*(string|number|boolean|void|unknown|never)\b/,
    weight: 2,
  },
  { language: 'tsx', pattern: /<\/[A-Z]\w*>|<[A-Z]\w*[^>]*\/>/, weight: 3 },
  { language: 'javascript', pattern: /\bfunction\s+\w*\s*\(|=>\s*[{(]/, weight: 2 },
  { language: 'javascript', pattern: /\b(const|let)\s+\w+\s*=/, weight: 1 },
  { language: 'javascript', pattern: /\b(console\.log|document\.|require\()/, weight: 2 },
  // A selector, then a declaration. The absence of parentheses before the
  // brace is what keeps a function body from matching.
  { language: 'css', pattern: /^\s*[^\n(){}]+\{\s*\r?\n?\s*[a-z-]+\s*:\s*[^;{}]+;/im, weight: 3 },
  { language: 'css', pattern: /@(media|import|keyframes)\b|--[\w-]+\s*:/, weight: 2 },
  { language: 'html', pattern: /<!doctype html>|<(div|span|p|body|head|html)\b[^>]*>/i, weight: 3 },
  { language: 'yaml', pattern: /^\s*-\s+\w+:\s|^\w[\w-]*:\s*$/m, weight: 2 },
  { language: 'markdown', pattern: /^#{1,6}\s+\S|^\s*[-*]\s+\S[\s\S]*^\s*[-*]\s+\S/m, weight: 2 },
]

/** Below this, the winner is not distinctive enough to be worth applying. */
const CONFIDENCE_FLOOR = 3

export function detectLanguage(code: string): LanguageId | undefined {
  const source = code.trim()
  // Too short to carry a signal. One line of `x = 1` is every language at once.
  if (source.length < 12) return undefined

  // JSON first, and by parsing rather than by pattern: it is the one language
  // here with an exact definition, so guessing at it would be perverse.
  if (/^[[{]/.test(source) && isJson(source)) return 'json'

  const scores = new Map<LanguageId, number>()
  for (const rule of RULES) {
    if (rule.pattern.test(source)) {
      scores.set(rule.language, (scores.get(rule.language) ?? 0) + rule.weight)
    }
  }
  if (scores.size === 0) return undefined

  const ranked = [...scores].toSorted((a, b) => b[1] - a[1])
  const [best, score] = ranked[0] as [LanguageId, number]
  if (score < CONFIDENCE_FLOOR) return undefined

  // A tie means the markers did not separate the candidates, and picking by
  // map order would be arbitrary dressed up as an answer.
  const runnerUp = ranked[1]
  if (runnerUp && runnerUp[1] === score) return undefined

  return best
}

function isJson(source: string): boolean {
  try {
    JSON.parse(source)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a chunk of plain text is Markdown someone means to keep as Markdown.
 *
 * Pasting `## Heading` should produce a heading, not the literal characters.
 * But most pasted text is prose, and a sentence beginning with a dash is not a
 * list — so the test is for *structure*: a marker that opens a line, of a kind
 * that has no other reason to be there.
 *
 * Only consulted when the clipboard carries no HTML. Copying from a web page
 * gives HTML, which already says exactly what the content is; guessing over
 * that would be replacing knowledge with a heuristic.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n')
  const markers = [
    /^#{1,6}\s+\S/, // heading
    /^\s*[-*+]\s+\S/, // bullet
    /^\s*\d+\.\s+\S/, // numbered item
    /^\s*>\s+\S/, // quote
    /^\s*```/, // fenced code
    /^\s*(-{3,}|\*{3,})\s*$/, // rule
    /^\s*\|.+\|\s*$/, // table row
  ]

  const structural = lines.filter((line) => markers.some((marker) => marker.test(line))).length
  if (structural === 0) return false

  // One marker in a long paste is more likely a coincidence than a document —
  // a single line starting with "- " inside three paragraphs of prose is a
  // dash, not a list.
  return structural >= 2 || lines.length <= 3
}
