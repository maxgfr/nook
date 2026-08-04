#!/usr/bin/env node
/**
 * Garde-fou « zéro réseau ».
 *
 * La vraie application de la règle est la CSP (`connect-src 'none'`) : même
 * une dépendance malveillante ne peut pas sortir. Ce script est le canari —
 * il fait échouer la CI *au moment où* du code capable d'émettre une requête
 * entre dans le bundle, plutôt qu'au moment où un utilisateur s'en aperçoit.
 *
 * Il inspecte le build, pas les sources : ce qui compte est ce qui est
 * réellement servi, dépendances comprises.
 *
 * Deux corpus distincts, parce qu'ils n'ont pas les mêmes droits :
 *   - le code applicatif n'a le droit d'appeler aucune API réseau ;
 *   - le service worker, lui, DOIT appeler `fetch` — c'est sa raison d'être —
 *     mais n'a le droit de mentionner aucune origine externe.
 *
 * Toute exception passe par ALLOWED et doit porter un motif lisible. Les
 * exceptions retenues sont réaffichées à chaque exécution : une dérogation
 * qu'on ne voit plus est une dérogation qu'on ne réexamine jamais.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname

/** APIs capables d'émettre une requête sortante. */
const NETWORK_APIS = [
  { name: 'fetch()', re: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', re: /\bWebSocket\s*\(/g },
  { name: 'EventSource', re: /\bEventSource\s*\(/g },
  { name: 'sendBeacon', re: /\bsendBeacon\s*\(/g },
  { name: 'importScripts()', re: /\bimportScripts\s*\(/g },
  { name: 'import() d’une URL absolue', re: /\bimport\s*\(\s*["'`]https?:/g },
]

/** URLs absolues dans le code servi. */
const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'`)<>\\]+/g

/**
 * Espaces de noms XML et adresses de boucle locale : ce sont des
 * identifiants, pas des adresses. Un SVG référence `www.w3.org/2000/svg`
 * sans que rien ne soit jamais téléchargé.
 */
const INERT_HOSTS = ['www.w3.org', 'localhost', '127.0.0.1']

/**
 * Dérogations explicites.
 *
 * `file` accepte `*`. `match` est la sous-chaîne trouvée. `reason` doit
 * expliquer pourquoi la trouvaille ne peut pas produire de requête — une
 * entrée sans motif est ignorée, donc la vérification échouera.
 */
const ALLOWED = [
  {
    file: 'assets/*.js',
    match: 'https://react.dev/errors/',
    reason:
      'Chaîne de caractères d’un message d’erreur minifié de React : l’URL est concaténée puis affichée dans la console, jamais requêtée.',
  },
  {
    file: 'assets/*.css',
    match: 'https://tailwindcss.com',
    reason: 'Bannière de licence, dans un commentaire CSS.',
  },
  {
    file: 'workbox-*.js',
    match: 'https://bit.ly/wb-precache',
    reason: 'URL citée dans le texte d’un `console.warn` de Workbox.',
  },
  {
    file: 'sw.js',
    match: 'importScripts(',
    reason:
      'Le service worker charge son propre runtime Workbox, servi depuis la même origine. Le scan des URL absolues de ce même fichier garantit qu’aucune origine externe n’y est référencée.',
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** Les attributs HTML sortent du build avec leurs guillemets échappés. */
function decodeEntities(html) {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const isInert = (url) => INERT_HOSTS.some((host) => url.includes(host))

const used = new Set()
function allowanceFor(file, match) {
  const rule = ALLOWED.find(
    (r) =>
      r.reason &&
      match.includes(r.match) &&
      new RegExp(`^${r.file.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(file),
  )
  if (rule) used.add(rule)
  return rule
}

/** Quelques caractères autour d'une trouvaille, pour la rendre jugeable. */
function excerpt(source, index, length) {
  const start = Math.max(0, index - 40)
  const end = Math.min(source.length, index + length + 40)
  const head = start > 0 ? '…' : ''
  const tail = end < source.length ? '…' : ''
  return `${head}${source.slice(start, end).replace(/\s+/g, ' ')}${tail}`
}

function scan(file, source, { isServiceWorker }) {
  const findings = []
  const name = relative(DIST, file)

  for (const api of NETWORK_APIS) {
    // `fetch` est la raison d'être d'un service worker : c'est par là qu'il
    // sert les fichiers précachés hors ligne.
    if (isServiceWorker && api.name === 'fetch()') continue
    for (const m of source.matchAll(api.re)) {
      if (allowanceFor(name, m[0])) continue
      findings.push({ file: name, kind: api.name, excerpt: excerpt(source, m.index, m[0].length) })
    }
  }

  for (const m of source.matchAll(ABSOLUTE_URL)) {
    if (isInert(m[0]) || allowanceFor(name, m[0])) continue
    findings.push({
      file: name,
      kind: `URL absolue ${m[0]}`,
      excerpt: excerpt(source, m.index, m[0].length),
    })
  }

  return findings
}

// --------------------------------------------------------------------------

if (!existsSync(DIST)) {
  console.error('✖ dist/ est absent. Lancez `pnpm build` avant cette vérification.')
  process.exit(1)
}

const files = walk(DIST).filter((f) => /\.(js|mjs|html|css)$/.test(f))
const isSW = (f) => /^(sw|workbox-[\w-]+)\.js$/.test(basename(f))

const findings = files.flatMap((file) =>
  scan(file, readFileSync(file, 'utf8'), { isServiceWorker: isSW(file) }),
)

// La CSP est la véritable barrière. Si elle disparaît du build, le canari ne
// vaut plus rien : on échoue même sans aucun appel réseau détecté.
const indexPath = join(DIST, 'index.html')
const index = existsSync(indexPath) ? decodeEntities(readFileSync(indexPath, 'utf8')) : ''
const cspProblems = []

if (!/http-equiv=["']Content-Security-Policy["']/i.test(index)) {
  cspProblems.push('index.html ne contient aucune balise Content-Security-Policy')
} else {
  for (const directive of ["connect-src 'none'", "default-src 'self'", "object-src 'none'"]) {
    if (!index.includes(directive)) cspProblems.push(`la CSP ne contient pas « ${directive} »`)
  }
}

// Un script inline serait de toute façon bloqué par `script-src 'self'`, mais
// mieux vaut le dire ici que le découvrir sur une page blanche en production.
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(index)) {
  cspProblems.push('index.html contient un script inline, que la CSP bloquera')
}

if (findings.length === 0 && cspProblems.length === 0) {
  console.log(`✔ ${files.length} fichiers servis inspectés, aucune sortie réseau possible.`)
  console.log("✔ CSP présente, avec connect-src 'none'.")
  if (used.size > 0) {
    console.log(`\n  ${used.size} dérogation(s) retenue(s) :`)
    for (const rule of used) console.log(`  · ${rule.file} — ${rule.match}\n    ${rule.reason}`)
  }
  const unused = ALLOWED.filter((r) => !used.has(r))
  if (unused.length > 0) {
    console.log('\n  Dérogations devenues inutiles, à supprimer de ALLOWED :')
    for (const rule of unused) console.log(`  · ${rule.file} — ${rule.match}`)
  }
  process.exit(0)
}

console.error('\n✖ La promesse « zéro réseau » n’est pas tenue par ce build.\n')
for (const problem of cspProblems) console.error(`  CSP — ${problem}`)
if (cspProblems.length > 0 && findings.length > 0) console.error('')
for (const f of findings) {
  console.error(`  ${f.file} — ${f.kind}`)
  console.error(`      ${f.excerpt}`)
}
console.error(`\n  ${findings.length} appel(s) réseau, ${cspProblems.length} problème(s) de CSP.`)
console.error(
  '  Si une trouvaille ne peut pas produire de requête, déclarez-la dans ALLOWED\n' +
    '  (scripts/check-no-network.mjs) en expliquant pourquoi.\n',
)
process.exit(1)
