import { describe, expect, it } from 'vitest'
import {
  DecryptionError,
  ENVELOPE_VERSION,
  isEnvelope,
  open,
  openJson,
  randomBytes,
  seal,
  sealJson,
} from './envelope'

function key() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)

describe('enveloppe chiffrée', () => {
  it('rend exactement ce qu’on lui a confié', async () => {
    const k = await key()
    const secret = bytes('Rendez-vous jeudi, sans faute.')

    const sealed = await seal(k, secret, 'docs/abc')

    expect(text(await open(k, sealed, 'docs/abc'))).toBe('Rendez-vous jeudi, sans faute.')
  })

  it('ne laisse pas le texte clair apparaître dans l’enveloppe', async () => {
    const k = await key()

    const sealed = await seal(k, bytes('code de la porte : 4271'), 'docs/abc')

    expect(text(sealed.ct)).not.toContain('4271')
    expect(sealed.v).toBe(ENVELOPE_VERSION)
    expect(sealed.iv).toHaveLength(12)
  })

  it('tire un nonce neuf à chaque écriture', async () => {
    const k = await key()
    const same = bytes('contenu identique')

    const first = await seal(k, same, 'docs/abc')
    const second = await seal(k, same, 'docs/abc')

    // Deux chiffrements du même texte doivent être indistinguables l'un de
    // l'autre pour qui lit le disque : sans nonce neuf, ils seraient identiques
    // et révéleraient qu'aucune modification n'a eu lieu.
    expect(first.iv).not.toEqual(second.iv)
    expect(first.ct).not.toEqual(second.ct)
  })

  it('refuse une autre clé', async () => {
    const sealed = await seal(await key(), bytes('secret'), 'docs/abc')

    await expect(open(await key(), sealed, 'docs/abc')).rejects.toThrow(DecryptionError)
  })

  it('refuse une enveloppe déplacée ailleurs', async () => {
    const k = await key()
    const sealed = await seal(k, bytes('les notes de A'), 'docs/A')

    // Recopier le contenu de A dans l'emplacement de B doit échouer : c'est
    // tout l'intérêt de lier l'enveloppe à sa position.
    await expect(open(k, sealed, 'docs/B')).rejects.toThrow(DecryptionError)
  })

  it('refuse une enveloppe altérée', async () => {
    const k = await key()
    const sealed = await seal(k, bytes('solde : 1000'), 'docs/abc')

    const corrupted = new Uint8Array(sealed.ct)
    corrupted.set([(corrupted[0] ?? 0) ^ 0xff], 0)

    await expect(open(k, { ...sealed, ct: corrupted }, 'docs/abc')).rejects.toThrow(DecryptionError)
  })

  it('refuse une enveloppe d’une autre version du format', async () => {
    const k = await key()
    const sealed = await seal(k, bytes('secret'), 'docs/abc')

    await expect(open(k, { ...sealed, v: 99 }, 'docs/abc')).rejects.toThrow(/version 99/)
  })

  it('refuse un enregistrement qui n’est pas une enveloppe', async () => {
    const k = await key()

    await expect(
      open(k, { nope: true } as unknown as Parameters<typeof open>[1], 'docs/abc'),
    ).rejects.toThrow(/pas une enveloppe/)
  })

  it('reconnaît la forme d’une enveloppe', async () => {
    const sealed = await seal(await key(), bytes('x'), 'docs/abc')

    expect(isEnvelope(sealed)).toBe(true)
    expect(isEnvelope({ v: 1, iv: [1, 2, 3], ct: [4] })).toBe(false)
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope('enveloppe')).toBe(false)
  })

  it('fait l’aller-retour sur du JSON', async () => {
    const k = await key()
    const doc = { titre: 'Réunion', tags: ['projet', 'urgent'], fait: false, notes: null }

    const sealed = await sealJson(k, doc, 'docs/abc')

    expect(await openJson(k, sealed, 'docs/abc')).toEqual(doc)
  })

  it('signale un contenu déchiffré mais illisible', async () => {
    const k = await key()
    // Le tag GCM sera valide : le contenu vient bien de nous, mais ce n'est
    // pas du JSON. C'est un bug de sérialisation, et le message doit le dire.
    const sealed = await seal(k, bytes('{ ceci n’est pas du JSON'), 'docs/abc')

    await expect(openJson(k, sealed, 'docs/abc')).rejects.toThrow(/JSON invalide/)
  })
})

describe('randomBytes', () => {
  it('renvoie la longueur demandée, et pas deux fois la même chose', () => {
    expect(randomBytes(12)).toHaveLength(12)
    expect(randomBytes(32)).not.toEqual(randomBytes(32))
  })
})
