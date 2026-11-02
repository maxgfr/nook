/**
 * Total destruction of local data.
 *
 * "Erase everything" has to be true. A local application that leaves behind a
 * service-worker cache or a forgotten database is lying to its user, and it is
 * the kind of lie only discovered at the worst possible moment.
 *
 * The order of operations is not cosmetic: the service worker is unregistered
 * first, because it is the only actor able to repopulate a cache while we are
 * emptying it.
 *
 * `surveyStorage()` exists so the interface can *show* what remains afterwards,
 * rather than display a confirmation nobody can verify.
 *
 * `clearAppCache()` shares the first two steps and stops there. Keeping the two
 * in one file is deliberate: the difference between them is the whole notebook,
 * and it should be readable in one screen rather than inferred from two names.
 *
 * "Everything" means everything **Nook** owns, and not one byte more. GitHub
 * Pages serves every project of an account from one origin
 * (`maxgfr.github.io/nook/`, `maxgfr.github.io/<other>/`…), and storage
 * belongs to the origin, not the path: the service-worker list, Cache Storage,
 * IndexedDB and both web storages are shared with every other site there.
 * Clearing them wholesale would erase other applications' data. So each step
 * only takes what is provably Nook's — see `isOwn*` below — and the inventory
 * only counts that.
 */

import { DB_NAME, deleteDatabase } from './idb'

export type StorageSurvey = {
  /** `undefined` when the browser refuses to enumerate databases (Firefox). */
  readonly databases: readonly string[] | undefined
  readonly caches: readonly string[]
  readonly serviceWorkers: number
  readonly localStorageKeys: number
  readonly sessionStorageKeys: number
}

export function isEmpty(survey: StorageSurvey): boolean {
  return (
    (survey.databases?.length ?? 0) === 0 &&
    survey.caches.length === 0 &&
    survey.serviceWorkers === 0 &&
    survey.localStorageKeys === 0 &&
    survey.sessionStorageKeys === 0
  )
}

export async function surveyStorage(scope: string = ownScope()): Promise<StorageSurvey> {
  const [databases, cacheNames, registrations] = await Promise.all([
    listDatabases(),
    globalThis.caches ? caches.keys() : Promise.resolve([]),
    ownRegistrations(scope),
  ])

  return {
    databases: databases?.filter(isOwnDatabase),
    caches: cacheNames.filter((name) => isOwnCache(name, scope)),
    serviceWorkers: registrations.length,
    localStorageKeys: ownKeys(() => localStorage).length,
    sessionStorageKeys: ownKeys(() => sessionStorage).length,
  }
}

export async function wipeEverything(scope: string = ownScope()): Promise<StorageSurvey> {
  // 1. The service worker first: it alone can write back into the caches.
  // 2. The caches, which hold the application itself.
  await clearAppCache(scope)

  // 3. The databases: Nook's, and any other `nook-*` database on this origin,
  //    because a database left by an earlier version would contain notes.
  const databases = (await listDatabases())?.filter(isOwnDatabase) ?? [DB_NAME]
  await Promise.all(databases.map((name) => deleteDatabase(name)))

  // 4. The simple storages (theme preference, and nothing sensitive) — Nook's
  //    keys only: the rest belongs to the other sites of the origin.
  removeOwnKeys(() => localStorage)
  removeOwnKeys(() => sessionStorage)

  return surveyStorage(scope)
}

/**
 * Throws away the copy of the application, and nothing else.
 *
 * The other half of "erase everything": same two first steps, and then it
 * stops. A browser can end up serving an application from a cache it will not
 * let go of — a worker that failed to update, a half-written precache — and the
 * cure is to take away the cache and let the next load fetch the files again.
 * That is a repair, not a deletion, and confusing it with one would be
 * catastrophic here: `wipeEverything()` above deletes every Nook database,
 * which is the notebook, unrecoverably.
 *
 * So this touches neither IndexedDB nor `localStorage`. The notes stay, and so
 * do the three preferences (`nook.theme`, `nook.webAccess`, `nook.snapshots`) —
 * the second of which decides the security policy the next load runs under, and
 * losing it would silently move somebody between the two documents.
 *
 * The order is the same as above, for the same reason: the service worker is
 * the only actor able to write back into a cache while it is being emptied.
 */
export async function clearAppCache(scope: string = ownScope()): Promise<void> {
  const registrations = await ownRegistrations(scope)
  await Promise.all(registrations.map((registration) => registration.unregister()))

  if (globalThis.caches) {
    const names = (await caches.keys()).filter((name) => isOwnCache(name, scope))
    await Promise.all(names.map((name) => caches.delete(name)))
  }
}

/** Prefix of Nook's `localStorage` / `sessionStorage` keys (`nook.theme`…). */
const KEY_PREFIX = `${DB_NAME}.`

/**
 * The URL Nook's service worker is registered for (`…/nook/`): the directory of
 * the current document, which is always at the root of the build. Empty outside
 * a browser, which then matches no registration and no Workbox cache.
 */
function ownScope(): string {
  const href = globalThis.location?.href
  return href ? new URL('.', href).href : ''
}

/** Nook's own database, and any `nook-…` one an earlier version left. */
export function isOwnDatabase(name: string): boolean {
  return name === DB_NAME || name.startsWith(`${DB_NAME}-`)
}

/**
 * Workbox names its caches after the registration scope
 * (`workbox-precache-v2-https://maxgfr.github.io/nook/`), which is what makes
 * them recognisable among the other sites' caches; `nook-…` covers anything
 * named by hand.
 */
export function isOwnCache(name: string, scope: string): boolean {
  return (scope !== '' && name.endsWith(scope)) || name.startsWith(`${DB_NAME}-`)
}

async function ownRegistrations(scope: string): Promise<readonly ServiceWorkerRegistration[]> {
  if (scope === '') return []
  const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
  return registrations.filter((registration) => registration.scope === scope)
}

async function listDatabases(): Promise<string[] | undefined> {
  // `indexedDB.databases()` is not available everywhere. When it is missing we
  // cannot claim to know what the origin holds: we return `undefined`
  // rather than an empty list, which would wrongly read as "nothing to erase".
  if (typeof indexedDB.databases !== 'function') return undefined
  try {
    const entries = await indexedDB.databases()
    return entries.map((entry) => entry.name).filter((name): name is string => Boolean(name))
  } catch {
    return undefined
  }
}

function ownKeys(get: () => Storage): string[] {
  try {
    const storage = get()
    const keys: string[] = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(KEY_PREFIX)) keys.push(key)
    }
    return keys
  } catch {
    // Storage blocked by the browser: there is nothing to count, and nothing to clear.
    return []
  }
}

function removeOwnKeys(get: () => Storage): void {
  try {
    const storage = get()
    for (const key of ownKeys(get)) storage.removeItem(key)
  } catch {
    // Same here: nothing to clear if access is denied.
  }
}
