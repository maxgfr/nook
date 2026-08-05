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

| Promise                              | Mechanism                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| The page cannot make a request       | `connect-src 'none'` in the CSP, in every document, always — not a setting                        |
| Nothing is fetched unless you say so | Two switches, both off, each naming what it costs — see [Letting the web in](#letting-the-web-in) |
| Nobody disabled that by accident     | CI inspects the published bundle and fails if network-capable code gets in ([the guard][g])       |
| Your notes are unreadable on disk    | AES-GCM-256 with a non-extractable key, never exposed to JavaScript                               |
| Everything really can be erased      | Database, caches, service worker and storages destroyed, then an inventory of what remains        |
| It works offline                     | Precached and installable as a PWA                                                                |
| You can tell which version you have  | Number, commit and date in Settings — with the two buttons that move you off it                   |

[g]: scripts/check-no-network.mjs

Out of the box, nothing leaves your machine. Two settings can change that, both
off, both named, and neither can be turned on without a screen telling you what
it gives away. The one thing they cannot touch is `connect-src 'none'`: Nook
itself never gains the ability to send anything anywhere.

### Staying up to date

An application that works offline is the one kind that can be a year behind
without anything going wrong enough to notice — the copy on your phone keeps
opening, so nothing ever raises the question. Settings raises it: it names the
version you are running, and holds the two ways off it.

**Check for updates** asks the site Nook was loaded from whether it has a newer
one. That request is made by the browser's own service-worker machinery and not
by the page, so `connect-src 'none'` is untouched and [the guard][g] never sees
it go by — which is exactly why it is written down here instead of left to be
discovered. Nothing from a note is involved. The host learns that you opened
Nook, which serving you the page had already told it.

**Reload** throws away the copy of the program this browser is holding and
fetches it again. It is the repair for a service worker stuck on files it will
not let go of. Your notes and every setting are untouched: it empties the cache
of the program, never of the data. Erasing everything is a different button, in
a different section, and it says so.

## What it does

- **Write.** A block editor with a slash menu, drag handles, headings, lists,
  checkboxes, code and tables. There is no Save button; edits are written after
  a pause in typing, when the tab goes to the background, and when you leave the
  page. Opening Nook puts you back in the page you last wrote in.
- **Organise.** Pages nest to any depth. Every page keeps up to twenty past
  versions you can walk back through and restore from — filed automatically on
  an interval you choose, or kept the moment you press **Snapshot**. Any one of
  them can be restored, or deleted — deleting asks twice, because a version
  exists nowhere but inside its own page.
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
- **Nest.** A page can show another page inside it, read-only, with a link to
  the real one. Entirely local — it is the same vault and the same key. A page
  that embeds itself is caught and said so, rather than recursed into.
- **Leave.** Export everything as plain JSON, import it back, or destroy the lot
  and read the storage back to check.
- **Share.** A page travels as an encrypted copy, as a link or as a file. See
  [Sharing](#sharing-a-page), which is mostly about what sharing without a
  server cannot do.

### A feature removed on purpose

The editor's emoji picker downloads its data **and its images** from a CDN at
runtime. The CSP would block those requests and the menu would be silently
empty — the worst of both worlds. Rather than switching it off with an option,
the library is [replaced at build time][stub], so the network code is not merely
unreachable: it is never served. Emoji typed on the system keyboard work as
usual.

[stub]: src/ui/editor/emoji-mart-absent.ts

## Letting the web in

Two things people reasonably want — a picture hosted elsewhere, a video player
— cannot exist under a policy this strict, because the browser fetches both. So
each is a switch in Settings, off, and each says what it costs before it moves.

**A policy can only ever be tightened at runtime, never loosened.** A flag in
memory therefore cannot open `img-src`. So the build emits **two documents**:

| Document        | Pictures from the web | Players from the web |
| --------------- | --------------------- | -------------------- |
| `index.html`    | refused               | refused              |
| `open-web.html` | allowed               | YouTube, Vimeo       |

They are generated from the same bytes and differ in exactly those two
directives — [the guard][g] fails the build if anything else differs, or if
`connect-src 'none'` is not identical in both. Turning a switch on moves you to
the second document, and the application closes back, at boot, whichever half
you did **not** ask for. The address bar therefore always says which promise is
in force, and once closed a door cannot be reopened for the life of the page.

What each one actually gives away:

- **Pictures from the web** — the site hosting the picture learns your address
  and that you are reading that page, every time you open it. Nook always offers
  to copy the picture into the vault instead, which asks the host once and never
  again; the note is then self-contained, works offline and travels with an
  export. Some hosts refuse to be copied, and Nook says so rather than failing
  quietly.
- **Players from the web** — opening a note with a player in it tells YouTube or
  Vimeo that you opened it. The page around it still cannot make a request; the
  player is a separate document, and that one can. The frame sends the site's
  origin and never the path, so what leaves is "somebody on this site opened a
  player" — which is implied by embedding one. YouTube refuses to play without
  it, so withholding it bought no privacy and lost the feature.

With both off, a block that points at the web shows what it points at and
contacts nobody.

One directive is **absent** rather than present-but-useless: `frame-ancestors`.
A `<meta>` element cannot carry it — the specification excludes it, and Chrome
ignores it with an error — and a static host cannot set response headers. It
used to sit in the policy doing nothing while looking like it was doing
something. The guard now refuses any directive a `<meta>` cannot enforce.

## Sharing a page

There is no server, so a shared page is a **copy**. Everything else follows from
that, and Nook says it on the screen where you press the button:

- **There is no revocation.** Once it has left, nothing can reach it. No such
  button is offered, because it could only be a lie.
- **There is no expiry.** You can ask that a page not be read after a date;
  Nook shows your reader that request and declines to open the page past it.
  That is a courtesy applied by the reader's copy of Nook, not a lock, and the
  reader is told exactly that — with a working button underneath.
- **The passphrase is the real protection**, and it is recommended rather than
  required. With one: Argon2id and AES-GCM-256, the same as the vault, and you
  send it by some other route than the link. Without one the page travels in
  the clear and anyone holding the link can read it — allowed, because that is
  a fine choice for a shopping list, and said plainly on both ends rather than
  made impossible. A _short_ passphrase is refused outright: it looks like
  protection without being any. Nook will suggest a strong one if you want it.

A share carries the page, its pictures, and nothing else — in particular **not
its history**, so the recipient does not receive every draft and every deleted
sentence. Under about 256 KB it goes as a link, in the URL fragment, which is
never sent to any server; above that Nook offers a file instead and explains
why, because long links get truncated in transit and fail at the far end with
nothing to say why.

Opening a share link does not create a notebook on the reader's machine. The
reader screen is rendered before the vault is ever opened; storage is touched
only if they press **Import into my notebook** — and then Nook opens the page it
has just created, so the copy is somewhere you can edit rather than somewhere
you have been told to go and look for.

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

`pnpm smoke` writes into `.smoke/`, which is gitignored: the browser profile it
drives, and the files the application genuinely downloads during the run. Those
used to land in the user's Downloads folder, which is not somewhere a test gets
to write.

`pnpm verify` is exactly what CI runs. `pnpm smoke` writes a note, links it,
searches it, maps it, locks the vault behind a passphrase, unlocks it, shares a
page and opens the share as a stranger would — against the built bundle, because
some defects only exist once the code is served. It caught the CSP blocking
WebAssembly, and a title field that looked like it lagged.

It also holds the checks the two-document design rests on, which are the kind of
claim that is worthless unless a browser is asked: that a policy inserted at
runtime is really enforced, that turning on pictures leaves players refused, and
that the strict document refuses both.

One thing `pnpm dev` cannot show you: there is no service worker in development,
so the version banner and everything around updating only exist in a real build.
Use `pnpm build && pnpm preview`.

### Commits, and the version number

The number in `package.json` is moved by CI, read off the commits, so that the
version shown in Settings is one nobody had to remember to bump. The sentence
stays the sentence this project writes — a Conventional Commits prefix goes in
front of it:

```
feat: Give Snapshot, Export and Share a key
fix: Make `verify` run the check that turned CI red
chore: Keep the files the tests download inside the project
```

`feat` moves the minor, `fix` and `perf` the patch, a trailing `!` or a
`BREAKING CHANGE:` paragraph the major — except below 1.0.0, where a break moves
the minor too, because calling the project stable should be a decision somebody
makes rather than one an exclamation mark makes for them. Anything else moves
nothing, and that is deliberate: a commit touching only this file does not
manufacture a release.

```bash
node scripts/bump-version.mjs   # what the next deployment would publish
```

## Run it on your own machine

```bash
docker compose up      # then open http://localhost:8080
```

Or without compose:

```bash
docker build -t nook .
docker run --rm -p 8080:8080 nook
```

The image and the published site serve the same files. The security policy
travels inside the HTML rather than in a response header — it has to, because a
static host cannot send headers — so the promise holds identically whoever is
serving it, and [the guard][g] runs inside the build so an image cannot ship a
bundle without it. What changes is only where the application itself comes from,
which for a program whose claim is that nothing leaves your machine is a
reasonable thing to want.

Your notes live in that browser, encrypted, exactly as they would on the
published site. Stopping the container does not touch them, and neither does
deleting the image.

## Host your own

1. Fork this repository.
2. Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`.

The sub-path is derived from the repository name, so renaming your fork is
enough — there is nothing to change in the code.

## Licence

[MIT](LICENSE).
