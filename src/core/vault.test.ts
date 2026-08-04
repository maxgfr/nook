import { describe, expect, it } from 'vitest'
import { Vault } from './vault'
import { isEnvelope } from './crypto/envelope'
import { openDatabase, read } from './storage/idb'

let counter = 0
const freshVault = () => Vault.open(`nook-vault-${++counter}`)

/**
 * Textes d'essai nommés une seule fois. Les répéter dans la donnée puis dans
 * l'assertion laisse les deux diverger en silence — et rend impossible de
 * distinguer une chaîne affichée d'un identifiant.
 */
const SECRET_TITLE = 'code de la porte'
const SECRET_BODY = 'le code est 4271'
const IMPORTED_TITLE = 'Carnet importé'
const SURVIVING_TITLE = 'Survit au rechargement'
const SURVIVING_CONTENT = [{ type: 'paragraph', text: 'contenu' }]

describe('coffre', () => {
  it('démarre vide', async () => {
    const vault = await freshVault()

    expect(vault.index.docs).toEqual({})
    expect(vault.children(null)).toEqual([])
  })

  it('crée un document et le relit', async () => {
    const vault = await freshVault()

    const created = await vault.createDoc({ title: 'Réunion produit' })
    const doc = await vault.readDoc(created.id)

    expect(doc.title).toBe('Réunion produit')
    expect(doc.parentId).toBeNull()
    expect(vault.children(null).map((d) => d.id)).toEqual([created.id])
  })

  it('enregistre le contenu et le rend tel quel', async () => {
    const vault = await freshVault()
    const created = await vault.createDoc()
    const content = [
      { type: 'heading', content: [{ text: 'Ordre du jour' }] },
      { type: 'checkListItem', props: { checked: true }, content: [{ text: 'Relire le devis' }] },
    ]

    await vault.saveDoc(created.id, { title: 'Jeudi', content })

    expect((await vault.readDoc(created.id)).content).toEqual(content)
  })

  it('fait remonter le titre dans l’index sans déchiffrer les contenus', async () => {
    const vault = await freshVault()
    const created = await vault.createDoc()

    await vault.saveDoc(created.id, { title: 'Titre visible dans la barre latérale' })

    expect(vault.index.docs[created.id]?.title).toBe('Titre visible dans la barre latérale')
  })

  it('horodate la dernière modification', async () => {
    const vault = await freshVault()
    const created = await vault.createDoc()

    const saved = await vault.saveDoc(created.id, { title: 'x' })

    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.createdAt).getTime(),
    )
  })

  it('retrouve tout après fermeture et réouverture', async () => {
    const name = `nook-vault-persistance-${++counter}`
    const first = await Vault.open(name)
    const created = await first.createDoc({ title: SURVIVING_TITLE })
    await first.saveDoc(created.id, { content: SURVIVING_CONTENT })
    first.close()

    const second = await Vault.open(name)

    expect(second.index.docs[created.id]?.title).toBe(SURVIVING_TITLE)
    expect((await second.readDoc(created.id)).content).toEqual(SURVIVING_CONTENT)
  })

  it('n’écrit sur le disque que des enveloppes chiffrées', async () => {
    const name = `nook-vault-chiffre-${++counter}`
    const vault = await Vault.open(name)
    const created = await vault.createDoc({ title: SECRET_TITLE })
    await vault.saveDoc(created.id, { content: [{ text: SECRET_BODY }] })
    vault.close()

    // On relit la base sans passer par le coffre : c'est ce que verrait
    // quelqu'un qui inspecte IndexedDB ou copie le profil du navigateur.
    const raw = await openDatabase(name)
    const storedDoc = await read(raw, 'docs', created.id)
    const storedIndex = await read(raw, 'index', 'index')

    expect(isEnvelope(storedDoc)).toBe(true)
    expect(isEnvelope(storedIndex)).toBe(true)
    expect(JSON.stringify(storedDoc)).not.toContain(SECRET_BODY)
    expect(JSON.stringify(storedIndex)).not.toContain(SECRET_TITLE)
  })

  it('prévient ses abonnés à chaque modification', async () => {
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
    it('emporte toute la descendance', async () => {
      const vault = await freshVault()
      const racine = await vault.createDoc({ title: 'Projet' })
      const enfant = await vault.createDoc({ parentId: racine.id })
      const petit = await vault.createDoc({ parentId: enfant.id })

      const removed = await vault.deleteDoc(racine.id)

      expect(removed.toSorted()).toEqual([racine.id, enfant.id, petit.id].toSorted())
      expect(vault.index.docs).toEqual({})
      await expect(vault.readDoc(petit.id)).rejects.toThrow(/introuvable/)
    })

    it('laisse les autres branches intactes', async () => {
      const vault = await freshVault()
      const a = await vault.createDoc({ title: 'A' })
      const b = await vault.createDoc({ title: 'B' })

      await vault.deleteDoc(a.id)

      expect(Object.keys(vault.index.docs)).toEqual([b.id])
    })
  })

  it('déplace un document et le retient', async () => {
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
    it('restitue à l’identique après un effacement', async () => {
      const source = await freshVault()
      const parent = await source.createDoc({ title: 'Carnet' })
      const enfant = await source.createDoc({ parentId: parent.id, title: 'Page' })
      await source.saveDoc(enfant.id, { content: [{ text: 'ne pas perdre ça' }] })

      const exported = await source.exportAll()

      // Le scénario réel : on exporte, on efface, on réimporte.
      const cible = await freshVault()
      await cible.importAll(exported, 'replace')

      expect(cible.index.docs[parent.id]?.title).toBe('Carnet')
      expect(cible.children(parent.id).map((d) => d.id)).toEqual([enfant.id])
      expect((await cible.readDoc(enfant.id)).content).toEqual([{ text: 'ne pas perdre ça' }])
    })

    it('remplace efface ce qui existait', async () => {
      const vault = await freshVault()
      const ancien = await vault.createDoc({ title: 'Ancien' })
      const exported = await vault.exportAll()
      await vault.deleteDoc(ancien.id)
      const autre = await vault.createDoc({ title: 'Autre' })

      await vault.importAll(exported, 'replace')

      expect(Object.keys(vault.index.docs)).toEqual([ancien.id])
      await expect(vault.readDoc(autre.id)).rejects.toThrow()
    })

    it('fusionne en réattribuant les identifiants en collision', async () => {
      const source = await freshVault()
      const parent = await source.createDoc({ title: IMPORTED_TITLE })
      await source.createDoc({ parentId: parent.id, title: 'Page importée' })
      const exported = await source.exportAll()

      // On réimporte dans le coffre d'origine : chaque identifiant existe déjà.
      const count = await source.importAll(exported, 'merge')

      expect(count).toBe(2)
      expect(Object.keys(source.index.docs)).toHaveLength(4)

      // Le point qui compte : la copie du parent a bien récupéré la copie de
      // l'enfant, et non l'enfant d'origine.
      const parents = Object.values(source.index.docs).filter((d) => d.title === IMPORTED_TITLE)
      expect(parents).toHaveLength(2)
      for (const p of parents) {
        expect(source.children(p.id)).toHaveLength(1)
      }
    })

    it('refuse un fichier qui n’est pas un export Nook', async () => {
      const vault = await freshVault()

      await expect(vault.importAll({ format: 'autre-chose' } as never, 'replace')).rejects.toThrow(
        /export Nook/,
      )
    })
  })
})
