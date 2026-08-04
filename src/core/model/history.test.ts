import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, MINUTE_MS, nextHistory, snapshotNow, type Snapshot } from './types'
import { Vault } from '../vault'

const at = (minutes: number) => new Date(2026, 7, 4, 12, minutes, 0)

/**
 * The interval these tests are about.
 *
 * Stated here rather than taken from the default, because the default is now
 * a setting: a test written against it would change meaning the day someone
 * changed the default, and would then be asserting something nobody chose.
 */
const EVERY_FIVE_MINUTES = { intervalMs: 5 * MINUTE_MS }

describe('deciding what to remember', () => {
  it('records the first edit', () => {
    const history = nextHistory(undefined, [{ text: 'first' }], at(0), EVERY_FIVE_MINUTES)

    expect(history).toHaveLength(1)
    expect(history[0]?.content).toEqual([{ text: 'first' }])
  })

  it('coalesces edits made minutes apart', () => {
    // Autosave fires every few seconds; without this the twenty slots would
    // all hold the same afternoon.
    const first = nextHistory(undefined, [{ text: 'a' }], at(0), EVERY_FIVE_MINUTES)
    const second = nextHistory(first, [{ text: 'b' }], at(2), EVERY_FIVE_MINUTES)

    expect(second).toEqual(first)
  })

  it('records again once enough time has passed', () => {
    const first = nextHistory(undefined, [{ text: 'a' }], at(0), EVERY_FIVE_MINUTES)
    const second = nextHistory(first, [{ text: 'b' }], at(6), EVERY_FIVE_MINUTES)

    expect(second).toHaveLength(2)
    expect(second[0]?.content).toEqual([{ text: 'b' }])
  })

  it('keeps the newest first', () => {
    let history: Snapshot[] = []
    for (const minute of [0, 10, 20]) {
      history = nextHistory(history, [{ text: `v${minute}` }], at(minute), EVERY_FIVE_MINUTES)
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
      history = nextHistory(history, [{ text: `v${index}` }], at(index * 10), EVERY_FIVE_MINUTES)
    }

    // Unbounded history would grow the record decrypted on every open, so old
    // states would slow down the thing they exist to protect.
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history.at(-1)?.content).toEqual([{ text: `v${5 + 1}` }])
  })

  it('files nothing at all when automatic snapshots are switched off', () => {
    const first = nextHistory(undefined, [{ text: 'a' }], at(0), { mode: 'never' })
    expect(first).toEqual([])

    // And an existing history is left exactly as it was, not emptied: turning
    // the setting off must not destroy what was already kept.
    const existing = nextHistory(undefined, [{ text: 'a' }], at(0), EVERY_FIVE_MINUTES)
    expect(nextHistory(existing, [{ text: 'b' }], at(600), { mode: 'never' })).toEqual(existing)
  })

  it('defaults to an hour, so twenty versions span a week of work', () => {
    // Five minutes spent the twenty slots on a single afternoon.
    const first = nextHistory(undefined, [{ text: 'a' }], at(0))
    expect(nextHistory(first, [{ text: 'b' }], at(30))).toEqual(first)
    expect(nextHistory(first, [{ text: 'b' }], at(61))).toHaveLength(2)
  })
})

describe('keeping a version because someone asked', () => {
  it('keeps the content as it stands, not what an edit replaced', () => {
    // The distinction is the whole point: pressing the button to mark a good
    // version and getting the *previous* one filed would be the opposite.
    const kept = snapshotNow(undefined, [{ text: 'the good version' }], at(0))

    expect(kept?.[0]?.content).toEqual([{ text: 'the good version' }])
    expect(kept?.[0]?.by).toBe('hand')
  })

  it('ignores the interval entirely', () => {
    const first = snapshotNow(undefined, [{ text: 'a' }], at(0)) ?? []
    // Seconds later, deliberately. Waiting out a clock is not a thing to ask
    // of someone who has just decided this version is worth keeping.
    expect(snapshotNow(first, [{ text: 'b' }], at(0))).toHaveLength(2)
  })

  it('refuses to keep the same text twice', () => {
    const first = snapshotNow(undefined, [{ text: 'a' }], at(0)) ?? []
    // Pressing twice must not spend two of the twenty slots on one version.
    expect(snapshotNow(first, [{ text: 'a' }], at(10))).toBeNull()
  })

  it('still forgets the oldest beyond the limit', () => {
    let history: Snapshot[] = []
    for (let index = 0; index <= HISTORY_LIMIT + 5; index++) {
      history = snapshotNow(history, [{ text: `v${index}` }], at(index)) ?? history
    }
    expect(history).toHaveLength(HISTORY_LIMIT)
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
    //
    // This used to assert a length of 1, which is what the *bug* produced: the
    // restore happened within the coalescing window, so the text it replaced
    // was merged into the snapshot before it and lost. The name of the test
    // and its assertion disagreed, and the assertion is the half that runs —
    // which is exactly how the defect survived. It now checks that the
    // replaced text is genuinely recoverable.
    const history = await vault.history(doc.id)
    expect(history).toHaveLength(2)
    expect(history[0]?.content).toEqual([{ text: 'original' }])
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
