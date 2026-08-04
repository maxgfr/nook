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
