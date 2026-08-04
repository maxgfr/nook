import { describe, expect, it } from 'vitest'
import { Vault } from './vault'
import { isEnvelope } from './crypto/envelope'
import { openDatabase, read } from './storage/idb'

let counter = 0
const freshVault = () => Vault.open(`nook-vault-${++counter}`)

/**
 * Test texts named exactly once. Repeating them in the data and then in the
 * assertion lets the two diverge in silence — and makes it impossible to tell
 * a displayed string from an identifier.
 */
const SECRET_TITLE = 'door code'
const SECRET_BODY = 'the code is 4271'
const IMPORTED_TITLE = 'Imported notebook'
const SURVIVING_TITLE = 'Survives a reload'
const SURVIVING_CONTENT = [{ type: 'paragraph', text: 'body text' }]

describe('coffre', () => {
  it('starts empty', async () => {
    const vault = await freshVault()

    expect(vault.index.docs).toEqual({})
    expect(vault.children(null)).toEqual([])
  })

  it('creates a document and reads it back', async () => {
    const vault = await freshVault()

    const created = await vault.createDoc({ title: 'Product meeting' })
    const doc = await vault.readDoc(created.id)

    expect(doc.title).toBe('Product meeting')
    expect(doc.parentId).toBeNull()
    expect(vault.children(null).map((d) => d.id)).toEqual([created.id])
  })

  it('stores the content and returns it unchanged', async () => {
    const vault = await freshVault()
    const created = await vault.createDoc()
    const content = [
      { type: 'heading', content: [{ text: 'Agenda' }] },
      { type: 'checkListItem', props: { checked: true }, content: [{ text: 'Review the quote' }] },
    ]

    await vault.saveDoc(created.id, { title: 'Jeudi', content })

    expect((await vault.readDoc(created.id)).content).toEqual(content)
  })

  it('surfaces the title in the index without decrypting any content', async () => {
    const vault = await freshVault()
    const created = await vault.createDoc()

    await vault.saveDoc(created.id, { title: 'Title visible in the sidebar' })

    expect(vault.index.docs[created.id]?.title).toBe('Title visible in the sidebar')
  })

  it('stamps the last modification time', async () => {
    const vault = await freshVault()
    const created = await vault.createDoc()

    const saved = await vault.saveDoc(created.id, { title: 'x' })

    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.createdAt).getTime(),
    )
  })

  it('recovers everything after closing and reopening', async () => {
    const name = `nook-vault-persistance-${++counter}`
    const first = await Vault.open(name)
    const created = await first.createDoc({ title: SURVIVING_TITLE })
    await first.saveDoc(created.id, { content: SURVIVING_CONTENT })
    first.close()

    const second = await Vault.open(name)

    expect(second.index.docs[created.id]?.title).toBe(SURVIVING_TITLE)
    expect((await second.readDoc(created.id)).content).toEqual(SURVIVING_CONTENT)
  })

  it('writes nothing but sealed envelopes to disk', async () => {
    const name = `nook-vault-chiffre-${++counter}`
    const vault = await Vault.open(name)
    const created = await vault.createDoc({ title: SECRET_TITLE })
    await vault.saveDoc(created.id, { content: [{ text: SECRET_BODY }] })
    vault.close()

    // We read the database back without going through the vault: this is what
    // someone inspecting IndexedDB or copying the browser profile.
    const raw = await openDatabase(name)
    const storedDoc = await read(raw, 'docs', created.id)
    const storedIndex = await read(raw, 'index', 'index')

    expect(isEnvelope(storedDoc)).toBe(true)
    expect(isEnvelope(storedIndex)).toBe(true)
    expect(JSON.stringify(storedDoc)).not.toContain(SECRET_BODY)
    expect(JSON.stringify(storedIndex)).not.toContain(SECRET_TITLE)
  })

  it('notifies its subscribers on every change', async () => {
    const vault = await freshVault()
    let notifications = 0
    const unsubscribe = vault.subscribe(() => notifications++)

    await vault.createDoc()
    expect(notifications).toBe(1)

    unsubscribe()
    await vault.createDoc()
    expect(notifications).toBe(1)
  })

  describe('suppression', () => {
    it('takes the whole subtree with it', async () => {
      const vault = await freshVault()
      const racine = await vault.createDoc({ title: 'Projet' })
      const enfant = await vault.createDoc({ parentId: racine.id })
      const petit = await vault.createDoc({ parentId: enfant.id })

      const removed = await vault.deleteDoc(racine.id)

      expect(removed.toSorted()).toEqual([racine.id, enfant.id, petit.id].toSorted())
      expect(vault.index.docs).toEqual({})
      await expect(vault.readDoc(petit.id)).rejects.toThrow(/not found/)
    })

    it('leaves the other branches untouched', async () => {
      const vault = await freshVault()
      const a = await vault.createDoc({ title: 'A' })
      const b = await vault.createDoc({ title: 'B' })

      await vault.deleteDoc(a.id)

      expect(Object.keys(vault.index.docs)).toEqual([b.id])
    })
  })

  it('moves a document and remembers it', async () => {
    const name = `nook-vault-deplacement-${++counter}`
    const vault = await Vault.open(name)
    const parent = await vault.createDoc({ title: 'Parent' })
    const enfant = await vault.createDoc({ title: 'Enfant' })

    await vault.moveDoc(enfant.id, parent.id)
    vault.close()

    const reopened = await Vault.open(name)
    expect(reopened.children(parent.id).map((d) => d.id)).toEqual([enfant.id])
  })

  describe('export et import', () => {
    it('restores identically after a wipe', async () => {
      const source = await freshVault()
      const parent = await source.createDoc({ title: 'Carnet' })
      const enfant = await source.createDoc({ parentId: parent.id, title: 'Page' })
      await source.saveDoc(enfant.id, { content: [{ text: 'do not lose this' }] })

      const exported = await source.exportAll()

      // The real scenario: you export, you erase, you re-import.
      const cible = await freshVault()
      await cible.importAll(exported, 'replace')

      expect(cible.index.docs[parent.id]?.title).toBe('Carnet')
      expect(cible.children(parent.id).map((d) => d.id)).toEqual([enfant.id])
      expect((await cible.readDoc(enfant.id)).content).toEqual([{ text: 'do not lose this' }])
    })

    it('replace erases what was there', async () => {
      const vault = await freshVault()
      const ancien = await vault.createDoc({ title: 'Ancien' })
      const exported = await vault.exportAll()
      await vault.deleteDoc(ancien.id)
      const autre = await vault.createDoc({ title: 'Autre' })

      await vault.importAll(exported, 'replace')

      expect(Object.keys(vault.index.docs)).toEqual([ancien.id])
      await expect(vault.readDoc(autre.id)).rejects.toThrow()
    })

    it('merges by reassigning colliding identifiers', async () => {
      const source = await freshVault()
      const parent = await source.createDoc({ title: IMPORTED_TITLE })
      await source.createDoc({ parentId: parent.id, title: 'Imported page' })
      const exported = await source.exportAll()

      // We re-import into the original vault: every identifier already exists.
      const count = await source.importAll(exported, 'merge')

      expect(count).toBe(2)
      expect(Object.keys(source.index.docs)).toHaveLength(4)

      // The point that matters: the copy of the parent really picked up the copy of
      // the child, and not the original child.
      const parents = Object.values(source.index.docs).filter((d) => d.title === IMPORTED_TITLE)
      expect(parents).toHaveLength(2)
      for (const p of parents) {
        expect(source.children(p.id)).toHaveLength(1)
      }
    })

    it('refuses a file that is not a Nook export', async () => {
      const vault = await freshVault()

      await expect(vault.importAll({ format: 'autre-chose' } as never, 'replace')).rejects.toThrow(
        /not a Nook export/,
      )
    })
  })
})

describe('history', () => {
  const FIRST = [{ type: 'paragraph', text: 'the first draft' }]
  const SECOND = [{ type: 'paragraph', text: 'the second draft' }]

  it('keeps what a restore replaces, however recently the last snapshot was taken', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc({ title: SURVIVING_TITLE })
    await vault.saveDoc(doc.id, { content: FIRST })
    await vault.saveDoc(doc.id, { content: SECOND })

    const [oldest] = await vault.history(doc.id)
    await vault.restore(doc.id, oldest?.at ?? '')

    // Restoring is an ordinary edit, so the state it replaced has to be
    // recoverable too: changing your mind about changing your mind must work.
    // Coalescing must not swallow this one, or a restore is a silent deletion
    // of whatever was on the page.
    const history = await vault.history(doc.id)
    const kept = history.some((snap) => JSON.stringify(snap.content) === JSON.stringify(SECOND))
    expect(kept).toBe(true)
  })

  it('still coalesces ordinary edits made moments apart', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc({ title: SURVIVING_TITLE })
    await vault.saveDoc(doc.id, { content: FIRST })
    await vault.saveDoc(doc.id, { content: SECOND })

    // Otherwise autosave would file a snapshot every few seconds and the
    // twenty slots would all hold the same afternoon.
    expect(await vault.history(doc.id)).toHaveLength(1)
  })
})

describe('preparing a page to be shared', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

  it('takes the title, the content and the files the page points at', async () => {
    const vault = await freshVault()
    const blobId = await vault.putBlob({ name: 'chart.png', type: 'image/png', bytes })
    const doc = await vault.createDoc({ title: SURVIVING_TITLE })
    await vault.saveDoc(doc.id, { content: [{ type: 'image', props: { url: `nook:${blobId}` } }] })

    const share = await vault.buildShare(doc.id)

    expect(share.title).toBe(SURVIVING_TITLE)
    expect(share.files.map((file) => file.id)).toEqual([blobId])
    expect(share.files[0]?.name).toBe('chart.png')
  })

  it('leaves behind the files the page does not point at', async () => {
    const vault = await freshVault()
    await vault.putBlob({ name: 'other-page.png', type: 'image/png', bytes })
    const doc = await vault.createDoc({ title: SURVIVING_TITLE })
    await vault.saveDoc(doc.id, { content: SURVIVING_CONTENT })

    // Sharing one page must not hand over the pictures from every other page.
    expect((await vault.buildShare(doc.id)).files).toEqual([])
  })

  it('never carries the page’s history', async () => {
    const vault = await freshVault()
    const doc = await vault.createDoc({ title: SURVIVING_TITLE })
    await vault.saveDoc(doc.id, { content: [{ type: 'paragraph', text: SECRET_BODY }] })
    await vault.saveDoc(doc.id, { content: [{ type: 'paragraph', text: 'the published version' }] })

    const share = await vault.buildShare(doc.id)

    // The document really does hold the earlier draft…
    expect((await vault.readDoc(doc.id)).history?.length).toBeGreaterThan(0)
    // …and sharing the page must not hand over every sentence ever deleted from it.
    expect(JSON.stringify(share)).not.toContain(SECRET_BODY)
    expect(JSON.stringify(share)).not.toContain('history')
  })
})

describe('adopting a page someone shared', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

  it('lands as a new top-level page, readable and searchable', async () => {
    const source = await freshVault()
    const doc = await source.createDoc({ title: SURVIVING_TITLE })
    await source.saveDoc(doc.id, { content: SURVIVING_CONTENT })

    const target = await freshVault()
    const adopted = await target.adoptShare(await source.buildShare(doc.id))

    expect(adopted.parentId).toBeNull()
    expect(adopted.id).not.toBe(doc.id)
    expect((await target.readDoc(adopted.id)).content).toEqual(SURVIVING_CONTENT)
    expect(target.index.facets[adopted.id]?.terms.length).toBeGreaterThan(0)
  })

  it('brings the pictures with it', async () => {
    const source = await freshVault()
    const blobId = await source.putBlob({ name: 'chart.png', type: 'image/png', bytes })
    const doc = await source.createDoc({ title: SURVIVING_TITLE })
    await source.saveDoc(doc.id, { content: [{ type: 'image', props: { url: `nook:${blobId}` } }] })

    const target = await freshVault()
    await target.adoptShare(await source.buildShare(doc.id))

    // The content refers to the file by its identifier, so an adopted page
    // whose pictures were dropped would render as a page full of holes.
    expect([...((await target.readBlob(blobId))?.bytes ?? [])]).toEqual([...bytes])
  })

  it('starts its own history rather than inheriting one', async () => {
    const source = await freshVault()
    const doc = await source.createDoc({ title: SURVIVING_TITLE })
    await source.saveDoc(doc.id, { content: SURVIVING_CONTENT })

    const target = await freshVault()
    const adopted = await target.adoptShare(await source.buildShare(doc.id))

    expect((await target.readDoc(adopted.id)).history ?? []).toEqual([])
  })
})

describe('files', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

  it('stores a file and hands it back unchanged', async () => {
    const vault = await freshVault()

    const id = await vault.putBlob({ name: 'diagram.png', type: 'image/png', bytes })
    const stored = await vault.readBlob(id)

    expect(stored?.name).toBe('diagram.png')
    expect(stored?.type).toBe('image/png')
    expect([...(stored?.bytes ?? [])]).toEqual([...bytes])
  })

  it('returns nothing for a file that is not there', async () => {
    const vault = await freshVault()

    expect(await vault.readBlob('missing')).toBeUndefined()
  })

  it('writes files to disk encrypted, like everything else', async () => {
    const name = `nook-vault-files-${++counter}`
    const vault = await Vault.open(name)
    const id = await vault.putBlob({ name: 'secret-plan.png', type: 'image/png', bytes })
    vault.close()

    const raw = await openDatabase(name)
    const onDisk = await read(raw, 'blobs', id)

    expect(isEnvelope(onDisk)).toBe(true)
    expect(JSON.stringify(onDisk)).not.toContain('secret-plan')
  })

  it('carries files through an export and back', async () => {
    const source = await freshVault()
    const id = await source.putBlob({ name: 'photo.png', type: 'image/png', bytes })

    const exported = await source.exportAll()
    const target = await freshVault()
    await target.importAll(exported, 'replace')

    // An export that silently dropped the images would look complete and
    // restore a notebook full of holes.
    expect([...((await target.readBlob(id))?.bytes ?? [])]).toEqual([...bytes])
  })

  it('re-encrypts files when the protection changes', async () => {
    const name = `nook-vault-files-rotate-${++counter}`
    const vault = await Vault.open(name)
    const id = await vault.putBlob({ name: 'photo.png', type: 'image/png', bytes })

    await vault.enablePassphrase('a sentence I will remember')
    vault.close()

    // Leaving files behind would produce a vault whose notes open and whose
    // pictures do not.
    const reopened = await Vault.unlock('a sentence I will remember', name)
    expect([...((await reopened.readBlob(id))?.bytes ?? [])]).toEqual([...bytes])
  }, 30_000)
})
