#!/usr/bin/env node
/**
 * End-to-end check, against the build that is actually served.
 *
 * The unit tests cover the core without a browser; this one does the thing
 * only a real browser can prove: you write a note, you reload the page, and
 * it is still there — while having left nothing but unreadable bytes on
 * disk.
 *
 * It drives Chrome over CDP. Node 24 ships a native WebSocket client, so no
 * browser-testing dependency enters the project.
 *
 *   pnpm build && pnpm smoke
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 4173
const BASE = process.env.SMOKE_URL ?? `http://localhost:${PORT}/nook/`
const DEBUG_PORT = 9333

/**
 * Where the files this test downloads are put.
 *
 * The application really does download things — a page as Markdown, the whole
 * notebook as JSON — and those are worth exercising for real rather than
 * stubbing out. Left to itself Chrome drops them in the user's Downloads
 * folder, which is where this repository happens to live: every run scattered
 * `nook-2026-08-05.json` and `Recipe-note.md` next to the source. They go here
 * instead, gitignored and emptied at the start of each run.
 */
const DOWNLOADS = new URL('../.smoke/downloads/', import.meta.url).pathname

/**
 * Addresses used only to see whether the policy refuses them.
 *
 * Nothing is ever fetched: there is no network in this harness, and the point
 * of each check is the `securitypolicyviolation` event, which fires before any
 * request would be made.
 */
const REMOTE_IMAGE = 'https://example.com/photo.png'
const REMOTE_FRAME = 'https://www.youtube-nocookie.com/embed/smoke'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path))
if (!chromePath) {
  console.error('✖ No Chrome found. Set CHROME_PATH.')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for a URL to answer, rather than betting on a fixed delay. */
async function waitFor(url, what) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      /* not ready yet */
    }
    await sleep(250)
  }
  throw new Error(`${what} did not answer on ${url}`)
}

rmSync(DOWNLOADS, { recursive: true, force: true })
mkdirSync(DOWNLOADS, { recursive: true })

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore' })
const profile = mkdtempSync(join(tmpdir(), 'nook-smoke-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,860',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  await waitFor(BASE, 'The preview server')
  const version = await waitFor(`http://localhost:${DEBUG_PORT}/json/version`, 'Chrome')
  const socket = new WebSocket((await version.json()).webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) waiting.reject(new Error(JSON.stringify(message.error)))
    else waiting.resolve(message.result)
  })

  let sessionId
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })

  // Sent before attaching to a page, so it reaches the browser target and
  // applies to every download this run makes. Without it they land in the
  // user's Downloads folder — see DOWNLOADS above.
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }))

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'exception')
    return result.value
  }

  const goto = async (url) => {
    await send('Page.enable')
    await send('Page.navigate', { url })
    await sleep(2500)
  }

  await goto(BASE)
  check('the page loads', (await evaluate('document.title')) === 'Nook')
  check(
    'the empty state greets the user',
    await evaluate(`document.body.innerText.includes('No page open')`),
  )

  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New page').click()`,
  )
  await sleep(2500)

  check(
    'the editor, loaded on demand, arrives',
    await evaluate(`!!document.querySelector('.bn-editor')`),
  )
  check(
    'the address points at the open page',
    (await evaluate('location.hash')).startsWith('#/doc/'),
  )

  // Typed key by key rather than assigned. Setting `.value` directly would
  // bypass the very defect worth catching: a controlled input bound to a value
  // that only changes after the debounced save rewrites the old text after
  // every keystroke, so the field looks frozen.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await evaluate(`document.querySelector('input[aria-label="Page title"]').focus()`)
  await send('Input.insertText', { text: 'Recipe note' })
  await sleep(400)
  check(
    'the title field shows what is typed into it',
    await evaluate(
      `document.querySelector('input[aria-label="Page title"]').value === 'Recipe note'`,
    ),
  )
  await sleep(1200)

  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  // `Input.insertText` takes the path of real typing; a bare `keyDown`
  // would be ignored by ProseMirror.
  await send('Input.insertText', { text: 'This text must survive a reload.' })
  await sleep(500)

  check(
    'typing reaches the editor',
    (await evaluate(`document.querySelector('.bn-editor').innerText`)).includes('survive'),
  )

  // --- Editor: Markdown, code blocks, menus ------------------------------
  //
  // Real key events, not `Input.insertText`: ProseMirror's input rules (``` for
  // a code block, / for the menu) never fire on spliced-in text, so a test that
  // assigns text proves nothing about typing.
  const pressKey = async (ch) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  const typeKeys = async (text) => {
    for (const ch of text) await pressKey(ch)
  }

  /** Presses the button whose label reads exactly `label`. */
  const clickButton = async (label) =>
    evaluate(
      `(() => {
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === ${JSON.stringify(label)},
        )
        if (!button) return false
        button.click()
        return true
      })()`,
    )

  // Run here, right after typing, because the caret is demonstrably in the
  // editor at this point. Restoring focus later proved unreliable, and a test
  // that depends on focus it did not establish is a flaky test.
  await pressKey('\r')
  await pressKey('/')
  await sleep(1000)
  const menu = await evaluate(`
    (() => {
      const found = [...document.querySelectorAll('body *')].find(
        (el) => el.offsetHeight > 80 && el.offsetWidth > 120 &&
          /menu|suggestion|dropdown|popover/i.test(el.className + ' ' + el.id),
      )
      if (!found) return { found: false }
      const box = found.getBoundingClientRect()
      return { found: true, clipped: box.bottom > innerHeight + 1 || box.top < -1 }
    })()
  `)
  check('the slash menu opens fully inside the viewport', menu.found && !menu.clipped)

  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  })
  await sleep(400)

  await typeKeys('``` ')
  await sleep(600)
  await typeKeys('def greet(name):')
  await pressKey('\r')
  await typeKeys('  print("hello")')
  await sleep(3000)

  check(
    'a code block picks its own language',
    await evaluate(
      `document.querySelector('[data-content-type=codeBlock]')?.dataset.language === 'python'`,
    ),
  )
  check(
    'the code is syntax highlighted',
    await evaluate(`document.querySelectorAll('.bn-editor span[style*="color"]').length > 3`),
  )

  await evaluate(`
    (() => {
      const editable = document.querySelector('.bn-editor[contenteditable=true]')
      const data = new DataTransfer()
      data.setData('text/plain', '## Pasted heading\\n\\n- one\\n- two')
      editable.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })()
  `)
  await sleep(2000)
  check(
    'pasted Markdown becomes real blocks',
    await evaluate(
      `[...document.querySelectorAll('[data-content-type]')].map((e) => e.dataset.contentType).join() .includes('heading')`,
    ),
  )

  await evaluate(`
    (() => {
      window.__downloaded = null
      const click = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__downloaded = this.download
        return click.call(this)
      }
    })()
  `)
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export').click()`,
  )
  await sleep(1000)
  check(
    'a page exports as Markdown',
    (await evaluate(`window.__downloaded`))?.endsWith?.('.md') === true,
  )

  // Let autosave fire.
  await sleep(1500)

  await goto(BASE)
  check(
    'the title is found again after a reload',
    await evaluate(`document.body.innerText.includes('Recipe note')`),
  )

  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Recipe note')).click()`,
  )
  await sleep(2500)

  check(
    'the content is found again after a reload',
    await evaluate(`document.body.innerText.includes('survive a reload')`),
  )

  // The promise hardest to verify any other way: what would be seen by
  // someone who opens the browser's database.
  const onDisk = await evaluate(`
    new Promise((resolve) => {
      const request = indexedDB.open('nook')
      request.onsuccess = () => {
        const all = request.result.transaction('docs').objectStore('docs').getAll()
        all.onsuccess = () => resolve(JSON.stringify(all.result))
      }
    })
  `)
  check(
    'the disk holds no plain text',
    !onDisk.includes('Recipe') && !onDisk.includes('survive'),
    `${onDisk.length} unreadable bytes`,
  )

  // --- Phase 3: links, tags, search --------------------------------------
  //
  // The headings in these sections are uppercased by CSS, and `innerText`
  // returns the *rendered* text, so these matches are deliberately
  // case-insensitive.
  const setTitle = (value) =>
    evaluate(`
      (() => {
        const input = document.querySelector('input[aria-label="Page title"]')
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setValue.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)

  await evaluate(
    `document.querySelector('nav[aria-label="Pages"] button[aria-label="New page"]').click()`,
  )
  await sleep(2500)
  await setTitle('Monday')
  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  await send('Input.insertText', { text: 'prepare [[Recipe note]] and [[Nowhere yet]] #urgent' })
  await sleep(1800)

  check(
    'a link leading nowhere is offered as a page to create',
    await evaluate(
      `/not written yet/i.test(document.body.innerText) && document.body.innerText.includes('nowhere yet')`,
    ),
  )

  await evaluate(
    `[...document.querySelectorAll('nav[aria-label="Pages"] button')].find((b) => b.textContent.includes('Recipe note')).click()`,
  )
  await sleep(2500)
  check(
    'backlinks list the page that links here',
    await evaluate(
      `/linked from 1 page/i.test(document.body.innerText) && document.body.innerText.includes('Monday')`,
    ),
  )

  // --- History, without a reload -----------------------------------------
  //
  // The panel hides itself while the list is empty, so a page that gained its
  // first snapshot while open used to show nothing at all and offer no control
  // to press. It came back on the next reload, which reads exactly like a save
  // that did not happen. This asserts it appears on its own.

  await evaluate(
    `document.querySelector('nav[aria-label="Pages"] button[aria-label="New page"]').click()`,
  )
  await sleep(2500)
  await setTitle('Digest')
  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  await send('Input.insertText', { text: 'A first line, which supersedes an empty page.' })
  await sleep(2000)

  check(
    'snapshots appear as soon as an edit replaces something, with no reload',
    await evaluate(`/show snapshots \\(\\d+\\)/i.test(document.body.innerText)`),
  )

  // --- Keeping a version by hand -----------------------------------------

  const snapshotCount = async () =>
    // Either label: the same control reads "Show" collapsed and "Hide" open.
    evaluate(
      `Number(/(?:show|hide) snapshots \\((\\d+)\\)/i.exec(document.body.innerText)?.[1] ?? 0)`,
    )

  const before = await snapshotCount()
  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  await send('Input.insertText', { text: ' A second line worth keeping.' })
  await sleep(1200)
  await clickButton('Snapshot')
  await sleep(2000)

  check(
    'the Snapshot button keeps a version straight away',
    (await snapshotCount()) === before + 1,
    `${before} → ${await snapshotCount()}`,
  )
  check(
    'and says so rather than pretending',
    await evaluate(`document.body.innerText.includes('Kept')`),
  )

  await clickButton('Snapshot')
  await sleep(2000)
  check(
    'pressing it again with nothing changed spends no slot',
    (await snapshotCount()) === before + 1 &&
      (await evaluate(`document.body.innerText.includes('Nothing new to keep')`)),
  )

  // --- Dropping a kept version -------------------------------------------

  /**
   * Scoped to the snapshots panel on purpose.
   *
   * A page-wide search for a button reading "Delete" finds the sidebar's
   * page-deletion confirmation first — it sits in a closed `<dialog>`, so no
   * person can reach it, but `.click()` does not care. A test that deletes a
   * page while claiming to delete a snapshot would pass for the wrong reason.
   */
  const clickInSnapshots = async (label) =>
    evaluate(
      `(() => {
        const panel = document.querySelector('section[aria-label="Snapshots"]')
        const button = [...(panel?.querySelectorAll('button') ?? [])].find(
          (b) => b.textContent.trim() === ${JSON.stringify(label)},
        )
        if (!button) return false
        button.click()
        return true
      })()`,
    )

  await clickInSnapshots(`Show snapshots (${await snapshotCount()})`)
  await sleep(600)
  const kept = await snapshotCount()

  check(
    'a snapshot offers to be deleted',
    await evaluate(
      `[...document.querySelectorAll('section[aria-label="Snapshots"] button')]
         .some((b) => b.textContent.trim() === 'Delete')`,
    ),
  )

  const asked = await clickInSnapshots('Delete')
  await sleep(400)
  check(
    'and asks a second time before it does',
    asked && (await evaluate(`document.body.innerText.includes('Delete for good')`)),
  )

  await clickInSnapshots('Delete for good')
  await sleep(1500)
  check(
    'deleting one leaves the rest, and the list says so without a reload',
    (await snapshotCount()) === kept - 1,
    `${kept} → ${await snapshotCount()}`,
  )

  // --- Embedding a page inside another -----------------------------------

  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  await pressKey('\r')
  await pressKey('/')
  await sleep(800)

  // The emoji picker is not in this build, so the menu must not offer it: an
  // entry that opens nothing is the failure its removal existed to avoid.
  check(
    'the slash menu does not offer the emoji picker that is not in this build',
    !(await evaluate(`/\\bEmoji\\b/.test(document.body.innerText)`)),
  )

  await typeKeys('embed')
  await sleep(800)
  check(
    'the slash menu offers to embed a page',
    await evaluate(`/embed a page/i.test(document.body.innerText)`),
  )

  await pressKey('\r')
  await sleep(800)
  check(
    'choosing which page opens a picker',
    await evaluate(`!!document.querySelector('dialog[aria-label="Choose a page to embed"]')`),
  )
  check(
    'which never offers the page you are already on',
    await evaluate(
      `![...document.querySelectorAll('dialog[aria-label="Choose a page to embed"] button')]
         .some((b) => b.textContent.trim() === 'Digest')`,
    ),
  )

  // Clicked rather than typed: `pressKey` reports `key: '\r'`, and the picker
  // — like every other keyboard handler in the application — listens for
  // `Enter`. The click is also the path most people take.
  const pickPage = async (title) =>
    evaluate(
      `(() => {
        const button = [...document.querySelectorAll('dialog[aria-label="Choose a page to embed"] button')]
          .find((b) => b.textContent.trim() === ${JSON.stringify(title)})
        if (!button) return false
        button.click()
        return true
      })()`,
    )

  check('the picker lists the page to embed', await pickPage('Monday'))
  await sleep(2500)

  check(
    'the embedded page is shown in place, with its own text',
    await evaluate(
      `document.body.innerText.includes('Monday') && document.body.innerText.includes('prepare')`,
    ),
  )

  // A embeds B; now make B embed A. Nothing stops someone doing it, and
  // without the chain guard the two would render each other until the tab died.
  await evaluate(
    `[...document.querySelectorAll('nav[aria-label="Pages"] button')].find((b) => b.textContent.trim() === 'Monday').click()`,
  )
  await sleep(2500)
  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  await send('Input.insertText', { text: ' ' })
  await sleep(400)
  await pressKey('\r')
  await pressKey('/')
  await sleep(800)
  await typeKeys('embed')
  await sleep(800)
  await pressKey('\r')
  await sleep(800)
  await pickPage('Digest')
  await sleep(3000)

  check(
    'a loop between two embedded pages is caught and named, not recursed into',
    await evaluate(`/already open further up/i.test(document.body.innerText)`),
  )

  await evaluate(
    `[...document.querySelectorAll('nav[aria-label="Pages"] button')].find((b) => b.textContent.trim() === 'Recipe note').click()`,
  )
  await sleep(2000)

  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'k',
    code: 'KeyK',
    modifiers: 4,
    windowsVirtualKeyCode: 75,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'k',
    code: 'KeyK',
    modifiers: 4,
    windowsVirtualKeyCode: 75,
  })
  await sleep(700)
  check(
    'the command palette opens on the keyboard',
    await evaluate(`!!document.querySelector('dialog[aria-label="Search and commands"][open]')`),
  )

  await send('Input.insertText', { text: 'urgent' })
  await sleep(600)
  check(
    'a tag is searchable from the palette',
    await evaluate(
      `document.querySelector('dialog[aria-label="Search and commands"]').innerText.includes('Monday')`,
    ),
  )

  // --- Databases ---------------------------------------------------------
  //
  // A database is a document with a different shape inside, so it inherits
  // encryption, search, history and export from the same code as a page. What
  // only a browser can show is that the three views really are views of one set
  // of rows.

  await evaluate(
    `(() => {
      const entry = [...document.querySelectorAll('dialog[aria-label="Search and commands"] button')]
        .find((b) => /new database|create database/i.test(b.textContent))
      if (!entry) return false
      entry.click()
      return true
    })()`,
  )
  await sleep(2500)

  const views = await evaluate(
    `[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())`,
  )
  check(
    'a database offers its three views of one set of rows',
    ['Table', 'Board', 'Calendar'].every((name) => views.includes(name)),
    views.join(', '),
  )

  // A fresh database shows an empty state rather than an empty grid, so the
  // table only exists once there is something in it.
  await clickButton('New row')
  await sleep(1200)
  const columns = await evaluate(
    `[...document.querySelectorAll('table th')].map((th) => th.textContent.trim()).filter(Boolean)`,
  )
  check(
    'and a new row gives it its typed columns',
    ['Name', 'Status', 'Due'].every((name) => columns.includes(name)),
    columns.join(', '),
  )

  await evaluate(
    `[...document.querySelectorAll('nav[aria-label="Pages"] button')].find((b) => b.textContent.trim() === 'Recipe note').click()`,
  )
  await sleep(2000)

  // --- Phases 6 & 7: history and the map ---------------------------------
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Map').click()`,
  )
  await sleep(1200)
  check(
    'the map shows a card per page and the link between them',
    await evaluate(
      `document.querySelectorAll('.absolute.origin-top-left button').length >= 2 && document.querySelectorAll('svg line').length >= 1`,
    ),
  )
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click()`,
  )
  await sleep(800)

  // --- Phase 4: passphrase and locking -----------------------------------
  //
  // Argon2id is deliberately slow, so these steps wait seconds rather than
  // milliseconds. That cost is the feature.
  const PASSPHRASE = 'a sentence I will remember'
  const setInput = (selector, value) =>
    evaluate(`
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)})
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setValue.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)

  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Settings').click()`,
  )
  await sleep(700)
  check(
    'locking is offered only once a copy exists',
    await evaluate(
      `[...document.querySelectorAll('dialog[aria-label="Settings"] button')].find((b) => b.textContent.includes('Protect with a passphrase')).disabled`,
    ),
  )

  await evaluate(
    `[...document.querySelectorAll('dialog[aria-label="Settings"] button')].find((b) => b.textContent.includes('Export everything')).click()`,
  )
  await sleep(1200)
  await setInput('input[aria-label="New passphrase"]', PASSPHRASE)
  await sleep(300)
  await evaluate(
    `[...document.querySelectorAll('dialog[aria-label="Settings"] button')].find((b) => b.textContent.includes('Protect with a passphrase')).click()`,
  )
  await sleep(8000)

  await goto(BASE)
  check(
    'a reload lands on the lock screen',
    await evaluate(`document.body.innerText.includes('Nook is locked')`),
  )
  check(
    'no page title leaks while locked',
    await evaluate(`!document.body.innerText.includes('Recipe note')`),
  )

  await setInput('input[aria-label="Passphrase"]', 'wrong one entirely')
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Unlock').click()`,
  )
  await sleep(6000)
  check(
    'a wrong passphrase is refused',
    await evaluate(`document.body.innerText.includes('Wrong passphrase')`),
  )

  await setInput('input[aria-label="Passphrase"]', PASSPHRASE)
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Unlock').click()`,
  )
  await sleep(8000)
  check(
    'the right passphrase opens the vault again',
    await evaluate(`document.body.innerText.includes('Recipe note')`),
  )

  // --- Sharing a page ----------------------------------------------------
  //
  // The round trip end to end: encrypt a page here, carry it in a fragment,
  // and open it as a reader would. What it proves that a unit test cannot is
  // that the fragment survives the trip and that the reader screen never
  // touches the notebook.

  const SHARE_PASSPHRASE = 'a sentence for the share'

  const fill = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    await send('Input.insertText', { text })
    await sleep(150)
  }
  // The reload above dropped the fragment, so the workspace is on its empty
  // state with the page only listed in the sidebar. Open it before sharing it.
  await evaluate(
    `(() => {
      const entry = [...document.querySelectorAll('nav[aria-label="Pages"] button')].find(
        (b) => b.textContent.trim() === 'Recipe note',
      )
      if (!entry) return false
      entry.click()
      return true
    })()`,
  )
  await sleep(2500)

  check('a page offers to be shared', await clickButton('Share'))
  await sleep(400)

  await fill('input[aria-label="Passphrase for this share"]', SHARE_PASSPHRASE)
  await fill('input[aria-label="Confirm the passphrase"]', SHARE_PASSPHRASE)
  check(
    'the dialog says a share cannot be recalled',
    await evaluate(`document.body.innerText.includes('cannot recall it')`),
  )
  check(
    'and refuses to call the date an expiry',
    await evaluate(`document.body.innerText.includes('It is not an expiry')`),
  )

  await clickButton('Prepare the share')
  // Argon2id is deliberately slow; this is the cost of the protection.
  await sleep(4000)

  const shareLink = await evaluate(
    `document.querySelector('input[aria-label="The share link"]')?.value ?? ''`,
  )
  check('a share link is produced', shareLink.includes('#/read/'))

  await goto(shareLink)
  check(
    'the link opens a reader, not the notebook',
    (await evaluate(`document.body.innerText.includes('shared a page with you')`)) &&
      !(await evaluate(`!!document.querySelector('nav[aria-label="Pages"]')`)),
  )

  await fill('input[aria-label="Passphrase"]', 'not the right words')
  await clickButton('Open')
  await sleep(4000)
  check(
    'a wrong passphrase does not open the share',
    await evaluate(`document.body.innerText.includes('does not open this page')`),
  )

  await evaluate(
    `(() => { const i = document.querySelector('input[aria-label="Passphrase"]'); i.focus(); i.select(); return true })()`,
  )
  await send('Input.insertText', { text: SHARE_PASSPHRASE })
  await sleep(150)
  await clickButton('Open')
  await sleep(4000)
  check(
    'the right passphrase renders the shared page',
    await evaluate(`document.body.innerText.includes('Recipe note')`),
  )
  check(
    'and the reader is told it is a read-only copy, with a way to import it',
    await evaluate(`
      /read-only/i.test(document.body.innerText) &&
      /\\bcopy\\b/i.test(document.body.innerText) &&
      [...document.querySelectorAll('button')].some((b) => /import into my notebook/i.test(b.textContent))
    `),
  )

  // --- The policy, and the two documents it lives in ---------------------
  //
  // These are the checks the product's central promise rests on, so they are
  // made against the served build rather than reasoned about. A CSP violation
  // is observed through `securitypolicyviolation`, which is the only signal
  // that tells "the policy refused this" apart from "there is no network here"
  // — and in this harness there is no network.

  const attemptImage = async (url) =>
    evaluate(`
      new Promise((resolve) => {
        let violated = false
        const onViolation = (event) => {
          if (event.violatedDirective.startsWith('img-src')) violated = true
        }
        document.addEventListener('securitypolicyviolation', onViolation)
        const img = new Image()
        const done = () => {
          document.removeEventListener('securitypolicyviolation', onViolation)
          resolve(violated)
        }
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
        img.src = ${JSON.stringify(url)}
        setTimeout(done, 2500)
      })
    `)

  const attemptFrame = async (url) =>
    evaluate(`
      new Promise((resolve) => {
        let violated = false
        const onViolation = (event) => {
          if (event.violatedDirective.startsWith('frame-src')) violated = true
        }
        document.addEventListener('securitypolicyviolation', onViolation)
        const frame = document.createElement('iframe')
        frame.src = ${JSON.stringify(url)}
        document.body.append(frame)
        setTimeout(() => {
          document.removeEventListener('securitypolicyviolation', onViolation)
          frame.remove()
          resolve(violated)
        }, 800)
      })
    `)

  const setWebAccess = async (remoteImages, externalEmbeds) =>
    evaluate(
      `localStorage.setItem('nook.webAccess', JSON.stringify({ remoteImages: ${remoteImages}, externalEmbeds: ${externalEmbeds} })), true`,
    )

  check('the default document refuses a picture from the web', await attemptImage(REMOTE_IMAGE))
  check('the default document refuses a player from the web', await attemptFrame(REMOTE_FRAME))

  // The whole two-document design rests on a policy inserted by script being
  // enforced. If this ever stopped being true, the settings would silently
  // stop closing the doors they claim to close.
  const tightening = await evaluate(`
    new Promise((resolve) => {
      const meta = document.createElement('meta')
      meta.httpEquiv = 'Content-Security-Policy'
      meta.content = "img-src 'self' data: blob:"
      document.head.append(meta)
      let violated = false
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.violatedDirective.startsWith('img-src')) violated = true
      }, { once: true })
      const img = new Image()
      const done = () => resolve(violated)
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
      img.src = 'https://example.com/inserted.png'
      setTimeout(done, 2500)
    })
  `)
  check('a policy inserted at runtime is enforced', tightening === true)

  await setWebAccess(false, false)
  await goto(`${BASE}open-web.html`)
  check(
    'the relaxed document sends you back when nothing is turned on',
    !(await evaluate('location.pathname')).includes('open-web'),
  )

  await setWebAccess(true, false)
  await goto(BASE)
  check(
    'turning on pictures moves to the other document',
    (await evaluate('location.pathname')).includes('open-web.html'),
  )
  check(
    'and the address bar says which promise is in force',
    (await evaluate('location.href')).includes('open-web.html'),
  )
  check('pictures from the web are now allowed', (await attemptImage(REMOTE_IMAGE)) === false)
  // The half that was not asked for is closed again at boot. This is what lets
  // one relaxed document serve two independent switches.
  check(
    'but players are still refused, because that switch is off',
    await attemptFrame(REMOTE_FRAME),
  )

  await setWebAccess(true, true)
  await goto(BASE)
  check('turning on players allows them too', (await attemptFrame(REMOTE_FRAME)) === false)

  await setWebAccess(false, false)
  await goto(BASE)
  check(
    'turning both off comes back to the strict document',
    !(await evaluate('location.pathname')).includes('open-web'),
  )

  socket.close()
} finally {
  chrome.kill()
  preview.kill()
}

const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.error(`
✖ ${failed.length} check(s) failed.`)
  process.exit(1)
}
console.log(`
✔ ${results.length} checks passed against the served build.`)
