/**
 * Remplaçant d'`emoji-mart`, substitué à la compilation.
 *
 * La bibliothèque de sélection d'emoji va chercher ses données d'internationa-
 * lisation *et* ses images sur un CDN, à l'exécution. C'est incompatible avec
 * la promesse de Nook : la CSP bloquerait ces requêtes, et le sélecteur serait
 * silencieusement cassé — la pire des deux situations, puisque l'utilisateur
 * verrait une fonctionnalité qui ne marche pas sans savoir pourquoi.
 *
 * Le désactiver par une option ne suffisait pas : le code partait quand même
 * dans les fichiers servis, et y serait resté à la merci d'un futur réglage.
 * Un alias dans `vite.config.ts` le remplace donc par ce module, et le
 * garde-fou réseau constate son absence.
 *
 * Ce qui est perdu : le menu d'emoji déclenché en tapant « : ». Les emoji
 * tapés au clavier système fonctionnent normalement, eux.
 *
 * Ce module sert d'alias à `emoji-mart` comme à `@emoji-mart/data` : le premier
 * lit des fonctions, le second un objet de données, et l'export par défaut vide
 * convient aux deux.
 */

const MESSAGE =
  'Le sélecteur d’emoji est retiré de Nook : il téléchargeait ses données depuis un CDN, ' +
  'ce qui contredit la promesse « aucune requête sortante ». Utilisez le clavier emoji du système.'

function unavailable(): never {
  // Volontairement bruyant. Si quelqu'un réactive le sélecteur un jour, il
  // doit tomber sur cette explication, pas sur un menu vide.
  throw new Error(MESSAGE)
}

export const init = unavailable
export const getEmojiDataFromNative = unavailable
export const SearchIndex = { search: unavailable }

export default {}
