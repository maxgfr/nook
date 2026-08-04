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
 * Findings are excused in one of two ways, and the difference is the point:
 *
 *   - `ALLOWED` — "this cannot produce a request." A string in an error
 *     message, a licence banner, a regex that happens to contain `fetch(`.
 *   - `DECLARED_EGRESS` — "this can produce a request, and here is exactly
 *     when." Nothing may be waved through under the first heading if it
 *     belongs under the second.
 *
 * Both lists are reprinted on every run: a waiver nobody sees again is a
 * waiver nobody ever re-examines, and an egress nobody restates is an egress
 * nobody agreed to.
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

// --------------------------------------------------------------------------
// What the two documents are allowed to say
//
// These strings are written out here rather than imported from
// `src/core/policy.ts` on purpose. A guard that read its expectations from the
// thing it is guarding would check the build against itself and pass whatever
// the build happened to contain. Stating them independently means loosening the
// policy takes two edits — and the second one is this file, which is the review
// step we actually want.
// --------------------------------------------------------------------------

/** Present, identical, in every document. `connect-src` is the promise itself. */
const SHARED_DIRECTIVES = {
  'default-src': "'self'",
  'base-uri': "'self'",
  'object-src': "'none'",
  'form-action': "'none'",
  'connect-src': "'none'",
  'script-src': "'self' 'wasm-unsafe-eval'",
  'style-src': "'self' 'unsafe-inline'",
  'media-src': "'self' blob:",
  'font-src': "'self'",
  'worker-src': "'self' blob:",
  'manifest-src': "'self'",
}

/**
 * The only two directives allowed to differ, and the only two documents.
 *
 * `index.html` is what everyone gets. `open-web.html` is reachable only by
 * turning on a setting; the application inserts a second, stricter policy at
 * boot for whichever half was not asked for — and a policy, once tightened,
 * cannot be widened again for the life of the document.
 */
const DOCUMENTS = {
  'index.html': {
    what: 'the default: nothing is fetched from anywhere',
    'img-src': "'self' data: blob:",
    'frame-src': "'none'",
  },
  'open-web.html': {
    what: 'reached only by turning on a setting that says what it costs',
    'img-src': "'self' data: blob: https:",
    'frame-src': 'https://www.youtube-nocookie.com https://player.vimeo.com',
  },
}

const VARIABLE_DIRECTIVES = ['img-src', 'frame-src']

/**
 * Directives a `<meta>` element cannot deliver.
 *
 * The specification excludes them, and Chrome logs an error and ignores them.
 * A static host cannot set response headers, so these are not merely
 * misplaced here — they are unavailable. One of them used to sit in this
 * project's policy doing nothing while looking like it was doing something,
 * which is worse than its absence.
 */
const META_INERT_DIRECTIVES = ['frame-ancestors', 'sandbox', 'report-uri', 'report-to']

/**
 * Explicit exemptions: findings that cannot produce a request.
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
    file: 'assets/php-*.js',
    match: 'fetch(',
    reason:
      'Alternations inside TextMate regex patterns, listing PHP database function names (mysqli_fetch_*, oci_fetch_*, imap_fetch*). Grammar data for the syntax highlighter, never executed as code.',
  },
  {
    file: 'sw.js',
    match: 'importScripts(',
    reason:
      'The service worker loads its own Workbox runtime, served from the same origin. Scanning this same file for absolute URLs guarantees no external origin is referenced in it.',
  },
]

/**
 * Hosts the product can genuinely reach, and under exactly what conditions.
 *
 * Nothing goes here without saying what leaves and when. These are not
 * exceptions to the promise — they are the promise, stated in full.
 */
const DECLARED_EGRESS = [
  {
    file: '*',
    match: 'https://www.youtube-nocookie.com',
    egress:
      'An iframe, in open-web.html only, only while "Players from the web" is on. Watching a note tells Google you are watching it. Nothing else about the note leaves: the page around it still cannot make a request.',
  },
  {
    file: '*',
    match: 'https://player.vimeo.com',
    egress:
      'An iframe, in open-web.html only, only while "Players from the web" is on. Watching a note tells Vimeo you are watching it. Nothing else about the note leaves.',
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

const matchesFile = (pattern, file) =>
  new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(file)

const usedAllowances = new Set()
const usedEgress = new Set()

/** The excuse covering a finding, if any, remembering which ones were needed. */
function excuseFor(file, match) {
  const egress = DECLARED_EGRESS.find(
    (rule) => rule.egress && match.includes(rule.match) && matchesFile(rule.file, file),
  )
  if (egress) {
    usedEgress.add(egress)
    return egress
  }

  const allowed = ALLOWED.find(
    (rule) => rule.reason && match.includes(rule.match) && matchesFile(rule.file, file),
  )
  if (allowed) usedAllowances.add(allowed)
  return allowed
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
      if (excuseFor(name, m[0])) continue
      findings.push({ file: name, kind: api.name, excerpt: excerpt(source, m.index, m[0].length) })
    }
  }

  for (const m of source.matchAll(ABSOLUTE_URL)) {
    if (isInert(m[0]) || excuseFor(name, m[0])) continue
    findings.push({
      file: name,
      kind: `absolute URL ${m[0]}`,
      excerpt: excerpt(source, m.index, m[0].length),
    })
  }

  return findings
}

/**
 * The policy of a document, as a map of directive to value.
 *
 * Takes the HTML *before* entity decoding, and decodes only the captured
 * attribute. The other way round, the `'self'` in every directive turns into a
 * real apostrophe and any attempt to find where the attribute ends stops at the
 * first one.
 */
function policyOf(rawHtml) {
  const tag = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i.exec(rawHtml)
  if (!tag) return null
  const content = /content="([^"]*)"/i.exec(tag[0])
  if (!content) return null

  const directives = {}
  for (const part of decodeEntities(content[1]).split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (name) directives[name.toLowerCase()] = values.join(' ')
  }
  return directives
}

function checkDocuments(problems) {
  const policies = {}

  for (const [file, expected] of Object.entries(DOCUMENTS)) {
    const path = join(DIST, file)
    if (!existsSync(path)) {
      problems.push(`${file} is missing from the build`)
      continue
    }

    const html = readFileSync(path, 'utf8')
    const policy = policyOf(html)
    if (!policy) {
      problems.push(`${file} carries no Content-Security-Policy`)
      continue
    }
    policies[file] = policy

    for (const [directive, value] of Object.entries(SHARED_DIRECTIVES)) {
      if (policy[directive] !== value) {
        problems.push(
          `${file} — ${directive} is "${policy[directive] ?? 'absent'}", expected "${value}"`,
        )
      }
    }

    for (const directive of VARIABLE_DIRECTIVES) {
      if (policy[directive] !== expected[directive]) {
        problems.push(
          `${file} — ${directive} is "${policy[directive] ?? 'absent'}", expected "${expected[directive]}"`,
        )
      }
    }

    for (const directive of META_INERT_DIRECTIVES) {
      if (directive in policy) {
        problems.push(
          `${file} — ${directive} cannot be delivered by a <meta> element. It does nothing here while looking like it does something; remove it.`,
        )
      }
    }

    // `wasm-unsafe-eval` is deliberate and narrow; `unsafe-eval` would also
    // switch on `eval()` and `new Function()`, and nothing here needs those.
    if (/(^|\s)'unsafe-eval'/.test(policy['script-src'] ?? '')) {
      problems.push(
        `${file} — script-src allows 'unsafe-eval'; only 'wasm-unsafe-eval' is intended`,
      )
    }

    // An inline script would be blocked by `script-src 'self'` anyway, but
    // better to say it here than to discover it on a blank page in production.
    if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) {
      problems.push(`${file} contains an inline script, which the CSP will block`)
    }
  }

  // The two documents must differ in the two named directives and in nothing
  // else. This is what makes "only pictures and players change" a fact rather
  // than an intention.
  const [strict, open] = Object.keys(DOCUMENTS).map((file) => policies[file])
  if (strict && open) {
    const names = new Set([...Object.keys(strict), ...Object.keys(open)])
    for (const directive of names) {
      if (VARIABLE_DIRECTIVES.includes(directive)) continue
      if (strict[directive] !== open[directive]) {
        problems.push(
          `the two documents differ in ${directive} ("${strict[directive]}" vs "${open[directive]}"); only ${VARIABLE_DIRECTIVES.join(' and ')} may differ`,
        )
      }
    }
  }

  // Every HTML document served must be one we know about. A page that slipped
  // into the build with no policy at all would otherwise go unnoticed.
  for (const file of walk(DIST).filter((f) => f.endsWith('.html'))) {
    const name = relative(DIST, file)
    if (!(name in DOCUMENTS)) {
      problems.push(`${name} is served but is not one of the documents this guard knows about`)
    }
  }
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

const cspProblems = []
checkDocuments(cspProblems)

if (findings.length === 0 && cspProblems.length === 0) {
  console.log(`✔ ${files.length} served files inspected, no undeclared network egress.`)
  for (const [file, expected] of Object.entries(DOCUMENTS)) {
    console.log(`✔ ${file} — ${expected.what}`)
  }
  console.log("✔ connect-src 'none' in every document, identical.")

  if (usedEgress.size > 0) {
    console.log(`\n  ${usedEgress.size} declared egress:`)
    for (const rule of usedEgress) console.log(`  · ${rule.match}\n    ${rule.egress}`)
  }
  if (usedAllowances.size > 0) {
    console.log(`\n  ${usedAllowances.size} waiver(s) in force:`)
    for (const rule of usedAllowances)
      console.log(`  · ${rule.file} — ${rule.match}\n    ${rule.reason}`)
  }

  const unused = [
    ...ALLOWED.filter((r) => !usedAllowances.has(r)),
    ...DECLARED_EGRESS.filter((r) => !usedEgress.has(r)),
  ]
  if (unused.length > 0) {
    console.log('\n  No longer needed, to remove from this script:')
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
  '  If a finding cannot produce a request, declare it in ALLOWED with the\n' +
    '  reason why. If it CAN produce one, it belongs in DECLARED_EGRESS, and the\n' +
    '  entry must say what leaves and when — see scripts/check-no-network.mjs.\n',
)
process.exit(1)
