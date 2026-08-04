#!/usr/bin/env node
/**
 * Vérification de bout en bout, sur le build réellement servi.
 *
 * Les tests unitaires couvrent le core sans navigateur ; celui-ci fait la
 * chose que seul un vrai navigateur peut prouver : on écrit une note, on
 * recharge la page, et elle est toujours là — tout en n'ayant laissé sur le
 * disque que des octets illisibles.
 *
 * Il pilote Chrome par CDP. Node 24 fournit un client WebSocket natif, donc
 * aucune dépendance de test navigateur n'entre dans le projet.
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
  console.error('✖ Aucun Chrome trouvé. Définissez CHROME_PATH.')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Attend qu'une URL réponde, plutôt que de parier sur un délai fixe. */
async function waitFor(url, what) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      /* pas encore prêt */
    }
    await sleep(250)
  }
  throw new Error(`${what} n’a pas répondu sur ${url}`)
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
  await waitFor(BASE, 'Le serveur de prévisualisation')
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
  check('la page se charge', (await evaluate('document.title')) === 'Nook')
  check(
    'l’état vide accueille l’utilisateur',
    await evaluate(`document.body.innerText.includes('Aucune page ouverte')`),
  )

  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nouvelle page').click()`,
  )
  await sleep(2500)

  check(
    'l’éditeur, chargé à la demande, arrive',
    await evaluate(`!!document.querySelector('.bn-editor')`),
  )
  check('l’adresse désigne la page ouverte', (await evaluate('location.hash')).startsWith('#/doc/'))

  await evaluate(`
    (() => {
      const input = document.querySelector('input[aria-label="Titre de la page"]')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'Note de recette')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()
  `)

  // Une page headless se croit en arrière-plan et refuse le focus : sans cette
  // émulation, toute saisie simulée partirait dans le vide.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await evaluate(`document.querySelector('.bn-editor[contenteditable=true]').focus()`)
  // `Input.insertText` emprunte le chemin d'une vraie saisie ; un `keyDown` nu
  // serait ignoré par ProseMirror.
  await send('Input.insertText', { text: 'Le texte doit survivre au rechargement.' })
  await sleep(500)

  check(
    'la frappe atteint l’éditeur',
    (await evaluate(`document.querySelector('.bn-editor').innerText`)).includes('survivre'),
  )

  // Laisse la sauvegarde automatique se déclencher.
  await sleep(1500)

  await goto(BASE)
  check(
    'le titre est retrouvé après rechargement',
    await evaluate(`document.body.innerText.includes('Note de recette')`),
  )

  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Note de recette')).click()`,
  )
  await sleep(2500)

  check(
    'le contenu est retrouvé après rechargement',
    await evaluate(`document.body.innerText.includes('survivre au rechargement')`),
  )

  // La promesse la plus difficile à vérifier autrement : ce que verrait
  // quelqu'un qui ouvre la base du navigateur.
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
    'le disque ne contient aucun texte en clair',
    !onDisk.includes('recette') && !onDisk.includes('survivre'),
    `${onDisk.length} octets illisibles`,
  )

  socket.close()
} finally {
  chrome.kill()
  preview.kill()
}

const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.error(`\n✖ ${failed.length} vérification(s) en échec.`)
  process.exit(1)
}
console.log(`\n✔ ${results.length} vérifications passées sur le build servi.`)
