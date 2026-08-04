import { describe, expect, it } from 'vitest'
import { isEmpty, surveyStorage, wipeEverything, type StorageSurvey } from './wipe'
import { openDatabase, write } from './idb'

/**
 * Ce fichier détruit tout le stockage de son environnement. Vitest isole
 * chaque fichier de test, donc l'effacement ne déborde pas sur les autres —
 * mais c'est la raison pour laquelle ces tests vivent seuls ici.
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
  it('supprime réellement les bases, et le prouve', async () => {
    const db = await openDatabase('nook-a-effacer')
    await write(db, 'docs', 'a', { secret: 'à ne pas retrouver' })
    db.close()

    expect((await surveyStorage()).databases).toContain('nook-a-effacer')

    const remaining = await wipeEverything()

    // L'inventaire renvoyé est relu après coup : c'est une constatation, pas
    // une promesse. L'interface peut donc l'afficher tel quel.
    expect(remaining.databases).toEqual([])
    expect(isEmpty(remaining)).toBe(true)
  })

  it('ne se plaint pas s’il n’y a rien à effacer', async () => {
    await expect(wipeEverything()).resolves.toBeDefined()
  })
})

describe('lecture de l’inventaire', () => {
  it('reconnaît un stockage vide', () => {
    expect(isEmpty(survey())).toBe(true)
  })

  it.each([
    ['une base', survey({ databases: ['nook'] })],
    ['un cache', survey({ caches: ['workbox-precache'] })],
    ['un service worker', survey({ serviceWorkers: 1 })],
    ['une clé de localStorage', survey({ localStorageKeys: 1 })],
    ['une clé de sessionStorage', survey({ sessionStorageKeys: 1 })],
  ])('ne dit pas « vide » quand il reste %s', (_, state) => {
    expect(isEmpty(state)).toBe(false)
  })

  it('traite « je ne peux pas savoir » comme rien à signaler', () => {
    // Firefox refuse d'énumérer les bases. On ne peut alors ni affirmer qu'il
    // en reste, ni le nier ; l'interface doit dire ce qu'elle sait, et le
    // reste du bilan garde sa valeur.
    expect(isEmpty(survey({ databases: undefined }))).toBe(true)
    expect(isEmpty(survey({ databases: undefined, caches: ['x'] }))).toBe(false)
  })
})
