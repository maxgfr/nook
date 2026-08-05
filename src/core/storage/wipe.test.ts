import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAppCache, isEmpty, surveyStorage, wipeEverything, type StorageSurvey } from './wipe'
import { openDatabase, read, write } from './idb'

/**
 * This file destroys all the storage in its environment. Vitest isolates each
 * test file, so the wipe does not spill over into the others — but that is
 * precisely why these tests live alone here.
 */

const survey = (patch: Partial<StorageSurvey> = {}): StorageSurvey => ({
  databases: [],
  caches: [],
  serviceWorkers: 0,
  localStorageKeys: 0,
  sessionStorageKeys: 0,
  ...patch,
})

describe('effacement total', () => {
  it('really deletes the databases, and proves it', async () => {
    const db = await openDatabase('nook-a-effacer')
    await write(db, 'docs', 'a', { secret: 'must not be found' })
    db.close()

    expect((await surveyStorage()).databases).toContain('nook-a-effacer')

    const remaining = await wipeEverything()

    // The returned inventory is read back afterwards: it is an observation, not
    // a promise. The interface can therefore show it as is.
    expect(remaining.databases).toEqual([])
    expect(isEmpty(remaining)).toBe(true)
  })

  it('does not complain when there is nothing to erase', async () => {
    await expect(wipeEverything()).resolves.toBeDefined()
  })
})

/** A browser's worker and cache storage, as much of them as `clearAppCache` uses. */
function stubBrowser() {
  const caches = new Map([
    ['workbox-precache-v2', {}],
    ['nook-assets', {}],
  ])
  const unregister = vi.fn(() => Promise.resolve(true))

  vi.stubGlobal('caches', {
    keys: () => Promise.resolve([...caches.keys()]),
    delete: (name: string) => Promise.resolve(caches.delete(name)),
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistrations: () => Promise.resolve([{ unregister }]) },
    configurable: true,
  })

  return { caches, unregister }
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

  it('takes away the worker and the caches', async () => {
    const { caches, unregister } = stubBrowser()

    await clearAppCache()

    expect(unregister).toHaveBeenCalledOnce()
    expect(caches.size).toBe(0)
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

    await clearAppCache()

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
