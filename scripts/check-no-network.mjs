#!/usr/bin/env node
/**
 * The "zero network" guard.
 *
 * The rule is really enforced by the CSP (`connect-src 'none'`): not even a
 * malicious dependency can get out. This script is the canary — it fails CI
 * *at the moment* code capable of emitting a request enters the bundle,
 * rather than at the moment a user notices.
 *
 * It inspects the build, not the sources: what matters is what is actually
 * served, dependencies included.
 *
 * Two distinct corpora, because they do not have the same rights:
 *   - application code may not call any network API;
 *   - the service worker, on the other hand, MUST call `fetch` — that is its
 *     whole purpose — but may not mention any external origin.
 *
 * Every exception goes through ALLOWED and must carry a readable reason. The
 * exceptions in force are reprinted on each run: a waiver nobody sees again
 * is a waiver nobody ever re-examines.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname

/** APIs capable of emitting an outgoing request. */
const NETWORK_APIS = [
  { name: 'fetch()', re: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', re: /\bWebSocket\s*\(/g },
  { name: 'EventSource', re: /\bEventSource\s*\(/g },
  { name: 'sendBeacon', re: /\bsendBeacon\s*\(/g },
  { name: 'importScripts()', re: /\bimportScripts\s*\(/g },
  { name: 'import() of an absolute URL', re: /\bimport\s*\(\s*["'`]https?:/g },
]

/** Absolute URLs in the served code. */
const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'`)<>\\]+/g

/**
 * XML namespaces and loopback addresses: these are identifiers, not
 * addresses. An SVG references `www.w3.org/2000/svg` without anything ever
 * being downloaded.
 */
const INERT_HOSTS = ['www.w3.org', 'localhost', '127.0.0.1']

/**
 * Explicit exemptions.
 *
 * `file` accepts `*`. `match` is the substring found. `reason` must explain
 * why the finding cannot produce a request — an entry without a reason is
 * ignored, so the check will fail.
 */
const ALLOWED = [
  {
    file: 'assets/*.js',
    match: 'https://react.dev/errors/',
    reason:
      'A string inside a minified React error message: the URL is concatenated then printed to the console, never requested.',
  },
  {
    file: 'assets/*.css',
    match: 'https://tailwindcss.com',
    reason: 'A licence banner, inside a CSS comment.',
  },
  {
    file: 'assets/*.js',
    match: 'https://prosemirror.net/docs/guide/',
    reason: 'A documentation link, inside the text of a schema error raised by ProseMirror.',
  },
  {
    file: 'assets/*.js',
    match: 'https://mantine.dev/theming/colors/',
    reason: 'A documentation link, inside the text of a Mantine configuration warning.',
  },
  {
    file: 'workbox-*.js',
    match: 'https://bit.ly/wb-precache',
    reason: 'A URL quoted inside the text of a Workbox `console.warn`.',
  },
  {
    file: 'sw.js',
    match: 'importScripts(',
    reason:
      'The service worker loads its own Workbox runtime, served from the same origin. Scanning this same file for absolute URLs guarantees no external origin is referenced in it.',
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

/** HTML attributes come out of the build with their quotes escaped. */
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

/** A few characters around a finding, so a human can judge it. */
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
    // `fetch` is the whole point of a service worker: it is how it
    // serves the precached files offline.
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
  console.error('✖ dist/ is missing. Run `pnpm build` before this check.')
  process.exit(1)
}

const files = walk(DIST).filter((f) => /\.(js|mjs|html|css)$/.test(f))
const isSW = (f) => /^(sw|workbox-[\w-]+)\.js$/.test(basename(f))

const findings = files.flatMap((file) =>
  scan(file, readFileSync(file, 'utf8'), { isServiceWorker: isSW(file) }),
)

// The CSP is the real barrier. If it disappears from the build, the canary
// is worth nothing: we fail even with no network call detected.
const indexPath = join(DIST, 'index.html')
const index = existsSync(indexPath) ? decodeEntities(readFileSync(indexPath, 'utf8')) : ''
const cspProblems = []

if (!/http-equiv=["']Content-Security-Policy["']/i.test(index)) {
  cspProblems.push('index.html contains no Content-Security-Policy tag')
} else {
  for (const directive of ["connect-src 'none'", "default-src 'self'", "object-src 'none'"]) {
    if (!index.includes(directive)) cspProblems.push(`the CSP does not contain "${directive}"`)
  }
}

// An inline script would be blocked by `script-src 'self'` anyway, but
// better to say it here than to discover it on a blank page in production.
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(index)) {
  cspProblems.push('index.html contains an inline script, which the CSP will block')
}

if (findings.length === 0 && cspProblems.length === 0) {
  console.log(`✔ ${files.length} served files inspected, no network egress possible.`)
  console.log("✔ CSP present, with connect-src 'none'.")
  if (used.size > 0) {
    console.log(`
  ${used.size} waiver(s) in force:`)
    for (const rule of used) console.log(`  · ${rule.file} — ${rule.match}\n    ${rule.reason}`)
  }
  const unused = ALLOWED.filter((r) => !used.has(r))
  if (unused.length > 0) {
    console.log('\n  Waivers that are no longer needed, to remove from ALLOWED:')
    for (const rule of unused) console.log(`  · ${rule.file} — ${rule.match}`)
  }
  process.exit(0)
}

console.error('\n✖ This build does not keep the "zero network" promise.\n')
for (const problem of cspProblems) console.error(`  CSP — ${problem}`)
if (cspProblems.length > 0 && findings.length > 0) console.error('')
for (const f of findings) {
  console.error(`  ${f.file} — ${f.kind}`)
  console.error(`      ${f.excerpt}`)
}
console.error(`
  ${findings.length} network call(s), ${cspProblems.length} CSP problem(s).`)
console.error(
  '  If a finding cannot produce a request, declare it in ALLOWED\n' +
    '  (scripts/check-no-network.mjs) en expliquant pourquoi.\n',
)
process.exit(1)
