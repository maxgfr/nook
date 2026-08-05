import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The core / UI boundary, verified rather than promised.
 *
 * An architectural rule that lives only in a documentation file erodes at the
 * first hurried import. This one breaks CI.
 *
 * What the separation buys, concretely: the core is testable without a browser
 * or a render, and the domain logic stays intact the day the interface changes
 * — or the day another client (an extension, a script) wants to read the same
 * vault.
 */

const SRC = new URL('../', import.meta.url).pathname
const CORE = join(SRC, 'core')
const UI = join(SRC, 'ui')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Every source of an `import ... from '…'` or an `import('…')`. */
function importsOf(source: string): string[] {
  const specifiers: string[] = []
  const statik = /\bfrom\s+['"]([^'"]+)['"]/g
  const dynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const bare = /^\s*import\s+['"]([^'"]+)['"]/gm
  for (const re of [statik, dynamic, bare]) {
    for (const match of source.matchAll(re)) specifiers.push(match[1] as string)
  }
  return specifiers
}

const FORBIDDEN_IN_CORE = [
  { pattern: /^react($|\/|-dom)/, why: 'React' },
  { pattern: /^@blocknote\//, why: 'BlockNote' },
  { pattern: /(^|\/)\.\.\/ui(\/|$)|(^|\/)ui\//, why: 'an interface module' },
]

describe('core / UI boundary', () => {
  const coreFiles = sourceFiles(CORE)

  it('the core exists and holds code', () => {
    // Without this guard, every test below would pass against an
    // empty directory, and the rule would hold by accident.
    expect(coreFiles.length).toBeGreaterThan(0)
  })

  it.each(FORBIDDEN_IN_CORE)('the core never imports $why', ({ pattern, why }) => {
    const offenders = coreFiles.flatMap((file) =>
      importsOf(readFileSync(file, 'utf8'))
        .filter((specifier) => pattern.test(specifier))
        .map((specifier) => `${relative(SRC, file)} imports “${specifier}”`),
    )

    expect(offenders, `The core must stay independent of ${why}.`).toEqual([])
  })

  it('the interface never talks directly to IndexedDB or WebCrypto', () => {
    let uiFiles: string[]
    try {
      uiFiles = sourceFiles(UI)
    } catch {
      // The interface arrives in phase 2; until then there is nothing to check.
      return
    }

    const offenders = uiFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const found: string[] = []
      if (/\bindexedDB\b/.test(source)) found.push('indexedDB')
      if (/\bcrypto\.subtle\b/.test(source)) found.push('crypto.subtle')
      return found.map((api) => `${relative(SRC, file)} uses ${api}`)
    })

    expect(
      offenders,
      'Storage and encryption go through the core, never through a component.',
    ).toEqual([])
  })
})
