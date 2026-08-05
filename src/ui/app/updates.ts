/**
 * How a new version reaches a copy that is already installed.
 *
 * This is the piece that was missing, and its absence had a shape worth
 * recording. `vite.config.ts` asked for `registerType: 'prompt'`, which is the
 * right choice — it means a new worker installs quietly and waits rather than
 * swapping the application out from under someone mid-sentence. But nothing in
 * this project ever listened for that prompt, and a waiting worker only takes
 * over once every tab of the application has closed. A notebook pinned to a
 * phone's home screen is never closed. The update was downloaded, installed,
 * and then sat there for as long as the phone lived.
 *
 * So: register the worker here, watch for the one that is waiting, and give the
 * interface something to show. Three states are enough — see `UpdateState`.
 *
 * **Registration is written out rather than imported from
 * `virtual:pwa-register`.** That module pulls in `workbox-window` as a chunk of
 * the served bundle, and this project's central promise is checked by
 * `scripts/check-no-network.mjs`, which fails the build when code capable of
 * emitting a request enters it. A dependency whose contents we would have to
 * re-audit on every upgrade is a poor trade for the sixty lines below.
 *
 * **On the network.** Checking for a new version asks the host the application
 * was loaded from whether it has a newer `sw.js`. That request is made by the
 * browser's own worker machinery, not by anything here — `connect-src 'none'`
 * is untouched, and the guard sees nothing, which is exactly why the settings
 * panel and the README say it in words. Nothing of a note is involved: the host
 * learns that somebody opened the application, which serving the first page had
 * already told it.
 */

import { useSyncExternalStore } from 'react'

export type UpdateState =
  /** No service worker here: development, or a browser without one. */
  | 'unsupported'
  /** Registered, nothing waiting. */
  | 'idle'
  /** A check asked for by a person is in flight. */
  | 'checking'
  /** A new version is installed and waiting for permission to take over. */
  | 'ready'

/** Between two automatic checks while the application stays open. */
const CHECK_EVERY = 60 * 60 * 1000

/**
 * Below this, coming back to the application does not trigger a check.
 *
 * Without it, a phone user switching between two applications would ask the
 * host on every glance. Fifteen minutes is far below the interval at which
 * anybody deploys and far above the rate at which anybody switches windows.
 */
const CHECK_AT_MOST_EVERY = 15 * 60 * 1000

/**
 * How long `applyUpdate` waits for the new worker to take over before
 * reloading anyway. The reload is what the person asked for; if the message
 * went unheard, they still get it.
 */
const HANDOVER_GRACE = 2000

let state: UpdateState = 'unsupported'
let registration: ServiceWorkerRegistration | null = null
let lastCheck = 0
let watching = false

const listeners = new Set<() => void>()

function setState(next: UpdateState): void {
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUpdateState(): UpdateState {
  // The server snapshot is never rendered — this application has no server —
  // but `useSyncExternalStore` wants one, and 'unsupported' is the truthful
  // answer anywhere the worker does not exist.
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => 'unsupported' as const,
  )
}

/**
 * Registers the worker and starts watching. Called once, from `main.tsx`.
 *
 * Not from `boot.ts`: that module is the first import for a documented reason
 * and settles the security policy before anything else runs. Nothing else
 * belongs in it.
 */
export function watchForUpdates(): void {
  if (watching) return
  watching = true

  // There is no `sw.js` in development — `devOptions.enabled: false` in
  // `vite.config.ts` — so registering would fail loudly for no reason. The
  // whole feature is exercised with `pnpm build && pnpm preview`.
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  const base = import.meta.env.BASE_URL

  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((registered) => {
      registration = registered
      setState('idle')

      // Already waiting on arrival: the case this whole module exists for. An
      // installed copy that has been behind for weeks lands here on its next
      // launch.
      if (registered.waiting) setState('ready')

      registered.addEventListener('updatefound', () => {
        const installing = registered.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // `installed` with no controller is the very first installation,
          // which is not an update and deserves no announcement.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setState('ready')
          }
        })
      })

      void check()
      startWatching()
    })
    .catch(() => {
      // A registration that fails leaves the application running from the
      // network exactly as it did before. Nothing here is worth an error on
      // screen.
    })
}

function startWatching(): void {
  setInterval(() => void check(), CHECK_EVERY)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastCheck < CHECK_AT_MOST_EVERY) return
    void check()
  })
}

/**
 * Asks the host whether it has something newer.
 *
 * Silent on failure, and that is the point: being unable to reach the host is
 * the normal condition of an application that promises to work without a
 * network. A notebook opened on a train must not report an error for having
 * failed to do something nobody asked for.
 */
async function check(): Promise<void> {
  if (!registration) return
  lastCheck = Date.now()
  try {
    await registration.update()
  } catch {
    // Offline, or the host is down. Neither is news.
  }
}

/**
 * The check behind the "Check for updates" button.
 *
 * Differs from the automatic one in exactly one way: a person is watching, so
 * the state moves visibly and comes back to rest even when nothing was found.
 */
export async function checkForUpdate(): Promise<void> {
  if (!registration) return
  setState('checking')
  await check()
  setState(registration.waiting ? 'ready' : 'idle')
}

/**
 * Hands over to the version that is waiting, and reloads onto it.
 *
 * The worker generated in `prompt` mode listens for this message and calls
 * `skipWaiting()`; the browser then fires `controllerchange`, and that is when
 * the page can safely be reloaded onto the new files. The guard flag matters:
 * without it Chrome reloads in a loop, because each reload can fire the event
 * again.
 *
 * The fallback timer is not defensive decoration. If the waiting worker never
 * answers — a worker from an older build, a browser quirk — the person still
 * pressed a button labelled Reload, and must get a reload.
 */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) {
    globalThis.location.reload()
    return
  }

  let reloaded = false
  const reload = () => {
    if (reloaded) return
    reloaded = true
    globalThis.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
  setTimeout(reload, HANDOVER_GRACE)

  // The lint rule asking for a target origin has `window.postMessage` in mind.
  // `ServiceWorker.postMessage` takes no such argument — the recipient is this
  // origin's own worker, named directly, and there is no other document to
  // address.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  waiting.postMessage({ type: 'SKIP_WAITING' })
}
