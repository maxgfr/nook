import { describe, expect, it } from 'vitest'
import { isEmpty, surveyStorage, wipeEverything, type StorageSurvey } from './wipe'
import { openDatabase, write } from './idb'

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
