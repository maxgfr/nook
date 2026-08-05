/**
 * Constants replaced at build time by the `define` block in `vite.config.ts`,
 * where their provenance is explained. They do not exist at runtime as
 * variables: the bundler substitutes the literal, so reading one costs nothing
 * and misspelling one fails to compile.
 *
 * The double underscore is the convention by which a bundler-substituted value
 * announces that it is not an ordinary variable, which is why these three are
 * named in the `no-underscore-dangle` allowance in `.oxlintrc.json` rather than
 * renamed to satisfy it.
 */

/** The number from `package.json`, e.g. `0.1.0`. */
declare const __APP_VERSION__: string

/** Seven characters of the commit built, or `unknown` where git was absent. */
declare const __APP_COMMIT__: string

/** ISO 8601 date of that commit — of the build itself when git was absent. */
declare const __APP_DATE__: string
