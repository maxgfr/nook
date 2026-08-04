/**
 * A stand-in for `emoji-mart`, substituted at build time.
 *
 * The emoji-picker library fetches its localisation data *and* its images
 * from a CDN, at runtime. That is incompatible with Nook's promise: the CSP
 * would block those requests, and the picker would be silently broken — the
 * worst of the two situations, since the user would see a feature that does
 * not work without knowing why.
 *
 * Disabling it with an option was not enough: the code still went into the
 * served files, and would have stayed there at the mercy of a future setting.
 * An alias in `vite.config.ts` therefore replaces it with this module, and
 * the network guard observes its absence.
 *
 * What is lost: the emoji menu triggered by typing ":". Emoji typed on the
 * system keyboard work normally.
 *
 * This module stands in for `emoji-mart` and for `@emoji-mart/data` alike: the
 * first reads functions, the second a data object, and the empty default
 * export suits both.
 */

const MESSAGE =
  'The emoji picker is removed from Nook: it downloaded its data from a CDN, ' +
  'which contradicts the "no outgoing request" promise. Use your system emoji keyboard.'

function unavailable(): never {
  // Deliberately loud. If someone re-enables the picker one day, they
  // should land on this explanation, not on an empty menu.
  throw new Error(MESSAGE)
}

export const init = unavailable
export const getEmojiDataFromNative = unavailable
export const SearchIndex = { search: unavailable }

export default {}
