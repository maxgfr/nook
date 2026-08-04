/**
 * Le vocabulaire de Nook.
 *
 * Une décision porte tout le reste : **le core ne connaît pas le format du
 * contenu d'un document**. Il le stocke, le chiffre, en extrait du texte pour
 * la recherche, mais ne sait pas ce qu'est un titre de niveau 2 ni une case à
 * cocher. Le contenu est du JSON opaque.
 *
 * Le bénéfice est direct : changer d'éditeur — ou en supporter deux — ne
 * touche pas une ligne de stockage, de chiffrement ou de recherche.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type DocId = string

/**
 * Ce que l'index garde en mémoire pour chaque document : de quoi peupler la
 * barre latérale, la palette et les fils d'Ariane sans déchiffrer un seul
 * contenu.
 */
export type DocSummary = {
  readonly id: DocId
  readonly parentId: DocId | null
  readonly title: string
  readonly icon: string | null
  readonly createdAt: string
  readonly updatedAt: string
  /** Position parmi ses frères. Voir `model/tree.ts` pour la mécanique. */
  readonly order: number
}

/** Un document complet, contenu inclus. Chargé à l'ouverture, un par un. */
export type Doc = DocSummary & {
  readonly content: JsonValue
}

/**
 * L'index du coffre : un unique enregistrement chiffré qui décrit tout, sauf
 * le contenu des documents.
 */
export type VaultIndex = {
  readonly schema: 1
  readonly docs: Readonly<Record<DocId, DocSummary>>
}

export const EMPTY_INDEX: VaultIndex = { schema: 1, docs: {} }

export function newId(): DocId {
  return crypto.randomUUID()
}

/** Titre affiché pour un document que l'utilisateur n'a pas encore nommé. */
export const UNTITLED = 'Sans titre'

/**
 * Extrait tout le texte lisible d'un contenu, quelle que soit sa forme.
 *
 * Volontairement structurel plutôt que sémantique : on récolte toutes les
 * chaînes de l'arbre JSON sans rien savoir du schéma de l'éditeur. C'est ce
 * qui permet à la recherche de fonctionner le jour où le format du contenu
 * change.
 */
export function extractText(content: JsonValue): string {
  const parts: string[] = []
  const visit = (node: JsonValue): void => {
    if (typeof node === 'string') {
      parts.push(node)
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child)
    } else if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node)) visit(child)
    }
  }
  visit(content)
  return parts.join(' ')
}
