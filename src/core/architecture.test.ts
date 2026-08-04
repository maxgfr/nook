import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * La frontière core / UI, vérifiée plutôt que promise.
 *
 * Une règle d'architecture qui ne vit que dans un fichier de documentation
 * s'érode au premier import pressé. Celle-ci casse la CI.
 *
 * Ce que la séparation achète concrètement : le core se teste sans navigateur
 * ni rendu, et la logique métier reste intacte le jour où l'interface change
 * — ou le jour où un autre client (une extension, un script) veut lire le
 * même coffre.
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

/** Toutes les sources d'un `import ... from '…'` ou d'un `import('…')`. */
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
  { pattern: /(^|\/)\.\.\/ui(\/|$)|(^|\/)ui\//, why: 'un module de l’interface' },
]

describe('frontière core / UI', () => {
  const coreFiles = sourceFiles(CORE)

  it('le core existe et contient du code', () => {
    // Sans cette garde, tous les tests ci-dessous passeraient sur un
    // répertoire vide, et la règle serait respectée par accident.
    expect(coreFiles.length).toBeGreaterThan(0)
  })

  it.each(FORBIDDEN_IN_CORE)('le core n’importe jamais $why', ({ pattern, why }) => {
    const offenders = coreFiles.flatMap((file) =>
      importsOf(readFileSync(file, 'utf8'))
        .filter((specifier) => pattern.test(specifier))
        .map((specifier) => `${relative(SRC, file)} importe « ${specifier} »`),
    )

    expect(offenders, `Le core doit rester indépendant de ${why}.`).toEqual([])
  })

  it('l’interface ne parle jamais directement à IndexedDB ni à WebCrypto', () => {
    let uiFiles: string[]
    try {
      uiFiles = sourceFiles(UI)
    } catch {
      // L'interface arrive en phase 2 ; d'ici là il n'y a rien à contrôler.
      return
    }

    const offenders = uiFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const found: string[] = []
      if (/\bindexedDB\b/.test(source)) found.push('indexedDB')
      if (/\bcrypto\.subtle\b/.test(source)) found.push('crypto.subtle')
      return found.map((api) => `${relative(SRC, file)} utilise ${api}`)
    })

    expect(
      offenders,
      'Le stockage et le chiffrement passent par le core, jamais par un composant.',
    ).toEqual([])
  })
})
