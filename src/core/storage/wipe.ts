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

export async function surveyStorage(): Promise<StorageSurvey> {
  const [databases, cacheNames, registrations] = await Promise.all([
    listDatabases(),
    globalThis.caches ? caches.keys() : Promise.resolve([]),
    navigator.serviceWorker?.getRegistrations?.() ?? Promise.resolve([]),
  ])

  return {
    databases,
    caches: cacheNames,
    serviceWorkers: registrations.length,
    localStorageKeys: countKeys(() => localStorage),
    sessionStorageKeys: countKeys(() => sessionStorage),
  }
}

export async function wipeEverything(): Promise<StorageSurvey> {
  // 1. The service worker first: it alone can write back into the caches.
  const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
  await Promise.all(registrations.map((registration) => registration.unregister()))

  // 2. The caches, which hold the application itself.
  if (globalThis.caches) {
    const names = await caches.keys()
    await Promise.all(names.map((name) => caches.delete(name)))
  }

  // 3. The databases: Nook's, and any other database on this origin, because
  //    a database left by an earlier version would contain notes.
  const databases = (await listDatabases()) ?? [DB_NAME]
  await Promise.all(databases.map((name) => deleteDatabase(name)))

  // 4. The simple storages (theme preference, and nothing sensitive).
  clear(() => localStorage)
  clear(() => sessionStorage)

  return surveyStorage()
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

function countKeys(get: () => Storage): number {
  try {
    return get().length
  } catch {
    // Storage blocked by the browser: there is nothing to count, and nothing to clear.
    return 0
  }
}

function clear(get: () => Storage): void {
  try {
    get().clear()
  } catch {
    // Same here: nothing to clear if access is denied.
  }
}
