/**
 * Destruction totale des données locales.
 *
 * « Tout effacer » doit être vrai. Une application locale qui laisse derrière
 * elle un cache du service worker ou une base oubliée ment à son utilisateur,
 * et c'est le genre de mensonge qui ne se découvre qu'au pire moment.
 *
 * L'ordre des opérations n'est pas cosmétique : le service worker est
 * désinscrit en premier, parce qu'il est le seul acteur capable de repeupler
 * un cache pendant qu'on le vide.
 *
 * `surveyStorage()` existe pour que l'interface puisse *montrer* ce qui reste après
 * coup, plutôt que d'afficher une confirmation que personne ne peut vérifier.
 */

import { DB_NAME, deleteDatabase } from './idb'

export type StorageSurvey = {
  /** `undefined` quand le navigateur refuse d'énumérer les bases (Firefox). */
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
  // 1. Le service worker d'abord : lui seul peut réécrire dans les caches.
  const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
  await Promise.all(registrations.map((registration) => registration.unregister()))

  // 2. Les caches, qui contiennent l'application elle-même.
  if (globalThis.caches) {
    const names = await caches.keys()
    await Promise.all(names.map((name) => caches.delete(name)))
  }

  // 3. Les bases : celle de Nook, et toute autre base de cette origine, car
  //    une base laissée par une version antérieure contiendrait des notes.
  const databases = (await listDatabases()) ?? [DB_NAME]
  await Promise.all(databases.map((name) => deleteDatabase(name)))

  // 4. Les stockages simples (préférence de thème, et rien de sensible).
  clear(() => localStorage)
  clear(() => sessionStorage)

  return surveyStorage()
}

async function listDatabases(): Promise<string[] | undefined> {
  // `indexedDB.databases()` n'existe pas partout. Quand il manque, on ne peut
  // pas prétendre connaître le contenu de l'origine : on renvoie `undefined`
  // plutôt qu'une liste vide, qui se lirait à tort comme « rien à effacer ».
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
    // Stockage bloqué par le navigateur : il n'y a rien à compter, ni à effacer.
    return 0
  }
}

function clear(get: () => Storage): void {
  try {
    get().clear()
  } catch {
    // Idem : rien à effacer si l'accès est refusé.
  }
}
