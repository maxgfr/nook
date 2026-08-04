/**
 * The first thing that runs, and it has to stay that way.
 *
 * Two jobs, in this order:
 *
 * 1. **Close whatever the user has not opened.** The relaxed document allows
 *    pictures from the web and provider frames; this inserts a second policy
 *    naming the ones that stay shut. A CSP can only ever be tightened at
 *    runtime, so this direction is the only one available — and it means that
 *    once this line has run, nothing loaded afterwards can widen it again.
 *
 * 2. **Move to the document that matches the settings.** Reaching
 *    `open-web.html` with both switches off — a bookmark, a hand-typed address
 *    — closes both doors first and then goes back to `index.html`, rather than
 *    leaving someone on a document looser than what they chose.
 *
 * ---
 *
 * **Why this is a module imported for its side effect rather than a function
 * called from `main.tsx`.** `import` declarations are hoisted above every
 * statement in a module, so a call written at the top of `main.tsx` would still
 * run *after* `import './styles.css'` and after React had been evaluated. Being
 * the first import is the only way to be first.
 */

import { documentFor, tighteningFor } from '../../core/policy'
import { readWebAccess } from './webAccess'

const access = readWebAccess()

const tightening = tighteningFor(access)
if (tightening) {
  const meta = document.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = tightening
  // Into `<head>`: Chrome ignores — and complains about — a policy element
  // found anywhere else.
  document.head.append(meta)
}

const base = import.meta.env.BASE_URL
const wanted = documentFor(access)
const path = globalThis.location.pathname
const here = path.startsWith(base) ? path.slice(base.length) : path

// `index.html` answers to two addresses: itself, and the bare directory. Both
// count as being in the right place, or this would redirect in a loop.
const inPlace = wanted === 'index.html' ? here === '' || here === 'index.html' : here === wanted

if (!inPlace) {
  // `replace` rather than an assignment: the address being left is not a page
  // anyone chose to visit, and it has no business in the back button.
  // The fragment carries the open page — or a whole shared note — across.
  globalThis.location.replace(
    `${base}${wanted === 'index.html' ? '' : wanted}${globalThis.location.hash}`,
  )
}
