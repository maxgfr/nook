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
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 4173
const BASE = process.env.SMOKE_URL ?? `http://localhost:${PORT}/nook/`
const DEBUG_PORT = 9333

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

  await evaluate(`
    (() => {
      const input = document.querySelector('input[aria-label="Page title"]')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'Recipe note')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)

  // A headless page believes it is in the background and refuses focus: without
  // emulation, any simulated typing would go nowhere.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  // `Input.insertText` takes the path of real typing; a bare `keyDown`
  // would be ignored by ProseMirror.
  await send('Input.insertText', { text: 'This text must survive a reload.' })
  await sleep(500)

  check(
    'typing reaches the editor',
    (await evaluate(`document.querySelector('.bn-editor').innerText`)).includes('survive'),
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
