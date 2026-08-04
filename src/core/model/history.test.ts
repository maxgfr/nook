import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, nextHistory, type Snapshot } from './types'
import { Vault } from '../vault'

const at = (minutes: number) => new Date(2026, 7, 4, 12, minutes, 0)

describe('deciding what to remember', () => {
  it('records the first edit', () => {
    const history = nextHistory(undefined, [{ text: 'first' }], at(0))

    expect(history).toHaveLength(1)
    expect(history[0]?.content).toEqual([{ text: 'first' }])
  })

  it('coalesces edits made minutes apart', () => {
    // Autosave fires every few seconds; without this the twenty slots would
    // all hold the same afternoon.
    const first = nextHistory(undefined, [{ text: 'a' }], at(0))
    const second = nextHistory(first, [{ text: 'b' }], at(2))

    expect(second).toEqual(first)
  })

  it('records again once enough time has passed', () => {
    const first = nextHistory(undefined, [{ text: 'a' }], at(0))
    const second = nextHistory(first, [{ text: 'b' }], at(6))

    expect(second).toHaveLength(2)
    expect(second[0]?.content).toEqual([{ text: 'b' }])
  })

  it('keeps the newest first', () => {
    let history: Snapshot[] = []
    for (const minute of [0, 10, 20]) {
      history = nextHistory(history, [{ text: `v${minute}` }], at(minute))
    }

    expect(history.map((snapshot) => snapshot.content)).toEqual([
      [{ text: 'v20' }],
      [{ text: 'v10' }],
      [{ text: 'v0' }],
    ])
  })

  it('forgets the oldest beyond the limit', () => {
    let history: Snapshot[] = []
    for (let index = 0; index <= HISTORY_LIMIT + 5; index++) {
      history = nextHistory(history, [{ text: `v${index}` }], at(index * 10))
    }

    // Unbounded history would grow the record decrypted on every open, so old
    // states would slow down the thing they exist to protect.
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history.at(-1)?.content).toEqual([{ text: `v${5 + 1}` }])
  })
})

let counter = 0
const freshVault = () => Vault.open(`nook-history-${++counter}`)

describe('history in a vault', () => {
  it('starts empty', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc({ title: 'Fresh' })

    expect(await vault.history(doc.id)).toEqual([])
  })

  it('keeps the state from before the writing session, not before the last keystroke', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()
    await vault.saveDoc(doc.id, { content: [{ text: 'first draft' }] })
    await vault.saveDoc(doc.id, { content: [{ text: 'second draft' }] })

    const history = await vault.history(doc.id)

    // Both saves land inside one interval, so one snapshot covers them — and
    // it holds the document as it was *before* the session. That is the
    // version worth having: if you delete a paragraph by accident and keep
    // typing for three minutes, a snapshot taken after the deletion would be
    // missing exactly what you came back for.
    expect(history).toHaveLength(1)
    expect(history[0]?.content).toEqual([])
    expect((await vault.readDoc(doc.id)).content).toEqual([{ text: 'second draft' }])
  })

  it('does not record a rename', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()
    await vault.saveDoc(doc.id, { content: [{ text: 'body' }] })
    const before = await vault.history(doc.id)

    await vault.saveDoc(doc.id, { title: 'Renamed' })

    expect(await vault.history(doc.id)).toEqual(before)
  })

  it('does not record a save that changed nothing', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()
    await vault.saveDoc(doc.id, { content: [{ text: 'same' }] })
    const before = await vault.history(doc.id)

    await vault.saveDoc(doc.id, { content: [{ text: 'same' }] })

    expect(await vault.history(doc.id)).toEqual(before)
  })

  it('puts a past state back', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()
    await vault.saveDoc(doc.id, { content: [{ text: 'the good version' }] })

    const [snapshot] = await vault.history(doc.id)
    await vault.saveDoc(doc.id, { content: [{ text: 'the regrettable one' }] })
    await vault.restore(doc.id, snapshot?.at as string)

    expect((await vault.readDoc(doc.id)).content).toEqual([])
  })

  it('snapshots the state a restore replaces', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()
    await vault.saveDoc(doc.id, { content: [{ text: 'original' }] })
    const [snapshot] = await vault.history(doc.id)

    await vault.restore(doc.id, snapshot?.at as string)

    // Restoring is an ordinary edit: changing your mind about changing your
    // mind has to work too.
    expect(await vault.history(doc.id)).toHaveLength(1)
  })

  it('refuses a version that no longer exists', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()

    await expect(vault.restore(doc.id, '2020-01-01T00:00:00.000Z')).rejects.toThrow(
      /no longer available/,
    )
  })

  it('keeps history out of the index', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc()
    await vault.saveDoc(doc.id, { content: [{ text: 'body' }] })

    // The index is decrypted on every launch; past states have no business
    // being in it.
    expect(JSON.stringify(vault.index.docs[doc.id])).not.toContain('body')
  })
})
