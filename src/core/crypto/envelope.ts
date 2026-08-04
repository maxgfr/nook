/**
 * Enveloppe chiffrée — l'unité de stockage de Nook.
 *
 * Tout ce qui est écrit sur le disque passe par ici. Rien d'autre dans le
 * projet n'appelle `crypto.subtle` pour chiffrer des données utilisateur.
 *
 * Le choix qui mérite d'être expliqué est le `context`. AES-GCM authentifie,
 * en plus du contenu, une donnée associée qui n'est pas chiffrée. On y place
 * l'emplacement de l'enregistrement. Conséquence : un attaquant ayant accès
 * au disque ne peut pas *déplacer* une enveloppe — recopier le contenu de
 * `docs/A` dans `docs/B` produit un échec d'authentification au lieu d'une
 * substitution silencieuse. Sans cela, le chiffrement protégerait la
 * confidentialité mais pas l'intégrité de la structure.
 */

export const ENVELOPE_VERSION = 1

/** AES-GCM impose 96 bits de nonce ; c'est aussi la seule taille recommandée. */
const IV_LENGTH = 12

/**
 * Vue sur un `ArrayBuffer` ordinaire.
 *
 * `Uint8Array` est générique sur son tampon depuis TypeScript 5.7, afin de
 * distinguer la mémoire partagée entre threads (`SharedArrayBuffer`) — que
 * WebCrypto refuse. L'alias évite de répéter cette précision à chaque
 * signature, et fait échouer à la compilation toute tentative de chiffrer un
 * tampon partagé.
 */
export type Bytes = Uint8Array<ArrayBuffer>

export type Envelope = {
  readonly v: number
  readonly iv: Bytes
  readonly ct: Bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class DecryptionError extends Error {
  override readonly name = 'DecryptionError'
}

export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Envelope>
  return (
    typeof candidate.v === 'number' &&
    candidate.iv instanceof Uint8Array &&
    candidate.ct instanceof Uint8Array
  )
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * Lie l'enveloppe à son emplacement. La version fait partie de la donnée
 * authentifiée : un futur changement de format ne pourra pas être présenté
 * comme un enregistrement de l'ancien.
 */
function associatedData(context: string): Bytes {
  return encoder.encode(`nook/v${ENVELOPE_VERSION}/${context}`)
}

/**
 * @param context Emplacement de l'enregistrement, par exemple `docs/<id>`.
 *   La même valeur devra être fournie au déchiffrement.
 */
export async function seal(key: CryptoKey, plaintext: Bytes, context: string): Promise<Envelope> {
  // Nonce aléatoire à chaque écriture. AES-GCM tolère environ 2³² chiffrements
  // par clé avec des nonces de 96 bits tirés au hasard ; un carnet de notes
  // n'en approchera jamais l'ordre de grandeur.
  const iv = randomBytes(IV_LENGTH)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(context) },
    key,
    plaintext,
  )
  return { v: ENVELOPE_VERSION, iv, ct: new Uint8Array(ct) }
}

export async function open(key: CryptoKey, envelope: Envelope, context: string): Promise<Bytes> {
  if (!isEnvelope(envelope)) {
    throw new DecryptionError('Enregistrement illisible : ce n’est pas une enveloppe Nook.')
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new DecryptionError(
      `Enveloppe en version ${envelope.v}, incompatible avec cette version de Nook (${ENVELOPE_VERSION}).`,
    )
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv, additionalData: associatedData(context) },
      key,
      envelope.ct,
    )
    return new Uint8Array(plaintext)
  } catch (cause) {
    // AES-GCM ne distingue pas « mauvaise clé » de « donnée altérée » de
    // « enveloppe déplacée » : dans les trois cas, la vérification du tag
    // échoue. Le message reste donc volontairement englobant.
    throw new DecryptionError(
      'Déchiffrement impossible : clé incorrecte, donnée altérée, ou enregistrement déplacé.',
      { cause },
    )
  }
}

export async function sealJson(key: CryptoKey, value: unknown, context: string): Promise<Envelope> {
  return seal(key, encoder.encode(JSON.stringify(value)), context)
}

export async function openJson<T>(key: CryptoKey, envelope: Envelope, context: string): Promise<T> {
  const bytes = await open(key, envelope, context)
  try {
    return JSON.parse(decoder.decode(bytes)) as T
  } catch (cause) {
    // Le tag GCM a été validé : le contenu vient bien de nous. Un JSON invalide
    // ici signale un bug de sérialisation, pas une attaque.
    throw new DecryptionError('Contenu déchiffré mais illisible : JSON invalide.', { cause })
  }
}
