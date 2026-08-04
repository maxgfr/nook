<div align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="">
  <h1>Nook</h1>
  <p><strong>A notebook that talks to nobody.</strong></p>
  <p>
    <a href="https://maxgfr.github.io/nook/">Open the app</a> ·
    <a href="#what-it-does">Features</a> ·
    <a href="#what-nook-protects-and-what-it-does-not">Security</a>
  </p>
</div>

---

Nook is a note-taking tool that runs entirely inside your browser. No account,
no server, no synchronisation. Your notes are encrypted on your own machine,
and the page is configured so that no outgoing request is possible at all.

It is a static site on GitHub Pages: the server sends files and never has
anything to receive back.

## The promise, and how it is kept

| Promise                           | Mechanism                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Nothing leaves your machine       | `connect-src 'none'` in the CSP — the browser refuses every outgoing request                |
| Nobody disabled that by accident  | CI inspects the published bundle and fails if network-capable code gets in ([the guard][g]) |
| Your notes are unreadable on disk | AES-GCM-256 with a non-extractable key, never exposed to JavaScript                         |
| Everything really can be erased   | Database, caches, service worker and storages destroyed, then an inventory of what remains  |
| It works offline                  | Precached and installable as a PWA                                                          |

[g]: scripts/check-no-network.mjs

## What it does

- **Write.** A block editor with a slash menu, drag handles, headings, lists,
  checkboxes, code and tables. There is no Save button; edits are written after
  a pause in typing, when the tab goes to the background, and when you leave the
  page.
- **Organise.** Pages nest to any depth. Every page keeps a bounded history you
  can walk back through and restore from.
- **Connect.** `[[Wikilinks]]` resolve by title, and every page lists what links
  to it. A link to a page you have not written yet is offered as a page to
  create rather than reported as an error. `#tags` work anywhere.
- **Find.** `⌘K` searches titles, tags and the text inside pages, and doubles as
  a command palette — new page, new database, today's note.
- **Structure.** Databases with typed columns (text, number, select, date,
  checkbox, URL), shown as a table, a board or a calendar. The three are views
  of one set of rows, with their own filters and sorts.
- **See the whole thing.** A map places every page on a plane you can pan and
  zoom, draws a line for every link, and remembers where you drag a card.
- **Print.** The reading column, without the application around it, with link
  destinations spelled out.
- **Leave.** Export everything as plain JSON, import it back, or destroy the lot
  and read the storage back to check.

Attaching images to a page is the one thing this does **not** do.

### A feature removed on purpose

The editor's emoji picker downloads its data **and its images** from a CDN at
runtime. The CSP would block those requests and the menu would be silently
empty — the worst of both worlds. Rather than switching it off with an option,
the library is [replaced at build time][stub], so the network code is not merely
unreachable: it is never served. Emoji typed on the system keyboard work as
usual.

[stub]: src/ui/editor/emoji-mart-absent.ts

## What Nook protects, and what it does not

By default the encryption key is generated on the device and kept in the browser
in a form JavaScript cannot read.

**What that protects:** anyone who copies your disk, your browser profile or a
backup gets nothing but unusable bytes.

**What it does not protect:** anyone who opens _your_ browser with _your_
unlocked session gets exactly the rights you have.

**Turning on a passphrase closes that gap.** Everything is re-encrypted under a
new key derived with Argon2id, the old key is destroyed, and the vault locks
itself after 15 idle minutes. There is no recovery — no server holds a copy — so
Nook makes you export before it will let you switch.

One directive is worth naming, because it looks like a compromise and is not.
`script-src` allows `'wasm-unsafe-eval'`: Chrome refuses to compile a
WebAssembly module without it, and Argon2id is one. It permits WebAssembly and
nothing else — not `eval()`, not `new Function()` — and the no-network promise
rests on `connect-src`, which is untouched. Falling back to PBKDF2 would have
traded real resistance to GPU cracking for a directive that buys nothing here.
The build gate fails if plain `'unsafe-eval'` ever appears.

## Architecture

Two halves, separated by a rule that CI enforces.

```
src/core/   Plain TypeScript — storage, encryption, model, search
src/ui/     React — components, editor, layout
```

The core imports neither React nor the editor; the interface never touches
IndexedDB or WebCrypto. That boundary is not a style convention —
[a test enforces it](src/core/architecture.test.ts) and breaks CI when it is
crossed. It is what lets the whole domain be tested without a browser, and the
interface be rebuilt without touching the data.

The core also does not know what a document's content _is_. It stores, encrypts
and indexes opaque JSON, which is why a database is simply a document with a
different shape inside — and why it inherits encryption, search, history and
export without a line of storage code of its own.

## Development

```bash
pnpm install
pnpm dev        # development server
pnpm test       # core tests, no browser
pnpm verify     # types, lint, tests, build, network guard
pnpm smoke      # drives a real browser through the whole product
```

`pnpm verify` is exactly what CI runs. `pnpm smoke` writes a note, links it,
searches it, maps it, locks the vault behind a passphrase and unlocks it again —
against the built bundle, because some defects only exist once the code is
served. It caught the CSP blocking WebAssembly, and a title field that looked
like it lagged.

## Host your own

1. Fork this repository.
2. Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`.

The sub-path is derived from the repository name, so renaming your fork is
enough — there is nothing to change in the code.

## Licence

[MIT](LICENSE).
