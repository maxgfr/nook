import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAppCache,
  isEmpty,
  isOwnCache,
  isOwnDatabase,
  surveyStorage,
  wipeEverything,
  type StorageSurvey,
} from './wipe'
import { openDatabase, read, write } from './idb'

/**
 * This file destroys all the storage in its environment. Vitest isolates each
 * test file, so the wipe does not spill over into the others — but that is
 * precisely why these tests live alone here.
 */

/** Where Nook is served: one site among many on a shared origin. */
const SCOPE = 'https://maxgfr.github.io/nook/'
const OTHER_SCOPE = 'https://maxgfr.github.io/another-app/'

/** A `Storage` holding `entries`, as much of one as the wipe uses. */
function memoryStorage(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries))
  return {
    store,
    storage: {
      get length() {
        return store.size
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => void store.delete(key),
      clear: () => {
        throw new Error('the origin is shared: never clear a whole storage')
      },
    },
  }
}

const survey = (patch: Partial<StorageSurvey> = {}): StorageSurvey => ({
  databases: [],
  caches: [],
  serviceWorkers: 0,
  localStorageKeys: 0,
  sessionStorageKeys: 0,
  ...patch,
})

describe('erasing everything', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('really deletes the databases, and proves it', async () => {
    const db = await openDatabase('nook-a-effacer')
    await write(db, 'docs', 'a', { secret: 'must not be found' })
    db.close()

    expect((await surveyStorage()).databases).toContain('nook-a-effacer')

    const remaining = await wipeEverything(SCOPE)

    // The returned inventory is read back afterwards: it is an observation, not
    // a promise. The interface can therefore show it as is.
    expect(remaining.databases).toEqual([])
    expect(isEmpty(remaining)).toBe(true)
  })

  it('does not complain when there is nothing to erase', async () => {
    await expect(wipeEverything(SCOPE)).resolves.toBeDefined()
  })

  it('leaves the other sites of the origin alone, and does not count what is theirs', async () => {
    const { caches, unregister, unregisterOther } = stubBrowser()
    const local = memoryStorage({
      'nook.theme': 'dark',
      'nook.webAccess': '{"remoteImages":true,"externalEmbeds":false}',
      theme: 'light',
      'another-app:settings': '{}',
    })
    const session = memoryStorage({ 'nook.draft': 'x', 'another-app:tab': '1' })
    vi.stubGlobal('localStorage', local.storage)
    vi.stubGlobal('sessionStorage', session.storage)

    const mine = await openDatabase('nook')
    mine.close()
    const theirs = await openDatabase('another-app-db')
    await write(theirs, 'docs', 'a', { kept: true })
    theirs.close()

    const remaining = await wipeEverything(SCOPE)

    expect(unregister).toHaveBeenCalledOnce()
    expect(unregisterOther).not.toHaveBeenCalled()
    expect([...caches.keys()]).toEqual([`workbox-precache-v2-${OTHER_SCOPE}`, 'another-app-assets'])
    expect([...local.store.keys()]).toEqual(['theme', 'another-app:settings'])
    expect([...session.store.keys()]).toEqual(['another-app:tab'])

    const reopened = await openDatabase('another-app-db')
    expect(await read(reopened, 'docs', 'a')).toEqual({ kept: true })
    reopened.close()

    // What belongs to the other sites is not "something left" of Nook.
    expect(remaining.databases).toEqual([])
    expect(isEmpty({ ...remaining, serviceWorkers: 0 })).toBe(true)
  })
})

describe("recognising Nook's storage among the origin's", () => {
  it('owns its database, and the ones earlier versions left', () => {
    expect(isOwnDatabase('nook')).toBe(true)
    expect(isOwnDatabase('nook-a-effacer')).toBe(true)
    expect(isOwnDatabase('keyval-store')).toBe(false)
    expect(isOwnDatabase('nookbook')).toBe(false)
  })

  it('owns the Workbox caches named after its scope, and nook-* caches', () => {
    expect(isOwnCache(`workbox-precache-v2-${SCOPE}`, SCOPE)).toBe(true)
    expect(isOwnCache('nook-assets', SCOPE)).toBe(true)
    expect(isOwnCache(`workbox-precache-v2-${OTHER_SCOPE}`, SCOPE)).toBe(false)
    expect(isOwnCache('workbox-precache-v2-https://maxgfr.github.io/', SCOPE)).toBe(false)
  })
})

/**
 * A browser's worker and cache storage, as much of them as `clearAppCache`
 * uses — with another site of the same origin registered next to Nook.
 */
function stubBrowser() {
  const caches = new Map([
    [`workbox-precache-v2-${SCOPE}`, {}],
    ['nook-assets', {}],
    [`workbox-precache-v2-${OTHER_SCOPE}`, {}],
    ['another-app-assets', {}],
  ])
  const unregister = vi.fn(() => Promise.resolve(true))
  const unregisterOther = vi.fn(() => Promise.resolve(true))

  vi.stubGlobal('caches', {
    keys: () => Promise.resolve([...caches.keys()]),
    delete: (name: string) => Promise.resolve(caches.delete(name)),
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistrations: () =>
        Promise.resolve([
          { scope: SCOPE, unregister },
          { scope: OTHER_SCOPE, unregister: unregisterOther },
        ]),
    },
    configurable: true,
  })

  return { caches, unregister, unregisterOther }
}

/**
 * The distance between these two operations is the whole notebook, so it is
 * asserted rather than trusted to a reviewer noticing the right function name.
 */
describe('clearing the application cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it("takes away Nook's worker and caches, and only those", async () => {
    const { caches, unregister, unregisterOther } = stubBrowser()

    await clearAppCache(SCOPE)

    expect(unregister).toHaveBeenCalledOnce()
    expect(unregisterOther).not.toHaveBeenCalled()
    expect([...caches.keys()]).toEqual([`workbox-precache-v2-${OTHER_SCOPE}`, 'another-app-assets'])
  })

  it('leaves the notes and the preferences exactly where they were', async () => {
    stubBrowser()
    const store = { 'nook.webAccess': '{"remoteImages":true}' }
    vi.stubGlobal('localStorage', {
      get length() {
        return Object.keys(store).length
      },
      clear: () => {
        throw new Error('clearAppCache must not touch localStorage')
      },
    })

    const db = await openDatabase('nook-kept')
    await write(db, 'docs', 'a', { cipher: 'unreadable bytes' })
    db.close()

    await clearAppCache(SCOPE)

    const reopened = await openDatabase('nook-kept')
    expect(await read(reopened, 'docs', 'a')).toEqual({ cipher: 'unreadable bytes' })
    reopened.close()

    // Losing this one would move somebody between the two security documents
    // without their having asked for anything.
    expect(store['nook.webAccess']).toBe('{"remoteImages":true}')
  })
})

describe('reading the inventory', () => {
  it('recognises empty storage', () => {
    expect(isEmpty(survey())).toBe(true)
  })

  it.each([
    ['a database', survey({ databases: ['nook'] })],
    ['a cache', survey({ caches: ['workbox-precache'] })],
    ['a service worker', survey({ serviceWorkers: 1 })],
    ['a localStorage key', survey({ localStorageKeys: 1 })],
    ['a sessionStorage key', survey({ sessionStorageKeys: 1 })],
  ])('does not report empty while %s remains', (_, state) => {
    expect(isEmpty(state)).toBe(false)
  })

  it('treats "I cannot know" as nothing to report', () => {
    // Firefox refuses to enumerate databases. We can then neither claim any
    // remain, nor deny it; the interface must say what it knows, and the
    // rest of the report keeps its value.
    expect(isEmpty(survey({ databases: undefined }))).toBe(true)
    expect(isEmpty(survey({ databases: undefined, caches: ['x'] }))).toBe(false)
  })
})
