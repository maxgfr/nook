// `vitest/config` re-exports Vite's `defineConfig` while also accepting the
// `test` key, which keeps the project's configuration in a single file.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import {
  OPEN_DOCUMENT,
  OPEN_FRAME,
  OPEN_IMG,
  STRICT_DOCUMENT,
  STRICT_FRAME,
  STRICT_IMG,
  // The extension is spelled out because Vite's native config loader, which
  // becomes the default in a future major, does not resolve it otherwise.
} from './src/core/policy.ts'

/**
 * Sub-path the site is served from. GitHub Pages serves a `nook` repository
 * under `/nook/`. A fork that renames the repository only has this line to
 * change (or the BASE environment variable).
 */
const BASE = process.env.BASE ?? '/nook/'

/**
 * Content Security Policy.
 *
 * `connect-src 'none'` is the heart of the product's promise: the browser
 * refuses every outgoing request (fetch, XHR, WebSocket, EventSource, beacon).
 * Even if a dependency tried to call a server, the page cannot.
 *
 * Injected only into the production build: the dev server needs a WebSocket
 * for hot reloading.
 *
 * `frame-ancestors` used to be in this list and has been removed. A `<meta>`
 * element cannot carry it — the specification excludes it along with `sandbox`
 * and `report-uri`, and Chrome logs an error and ignores it. It was therefore
 * doing nothing while looking like it was doing something, which is worse than
 * its absence. A static host cannot set response headers, so protection against
 * being framed is not available here at all; saying so is the honest option.
 * `scripts/check-no-network.mjs` now refuses any directive a `<meta>` cannot
 * enforce, so it cannot come back by accident.
 */
function policy(img: string, frame: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'none'",
    "connect-src 'none'",
    // `wasm-unsafe-eval` allows compiling WebAssembly, and nothing else — it
    // does NOT permit `eval()` or `new Function()`. Argon2id, which turns the
    // passphrase into a key, is a WebAssembly module, and Chrome refuses to
    // compile it under `script-src 'self'` alone. The alternative was to fall
    // back on PBKDF2, trading real resistance to GPU cracking for a directive
    // that buys nothing here: the no-network promise rests on `connect-src`,
    // which is untouched.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    img,
    frame,
    "media-src 'self' blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ')
}

const STRICT_CSP = policy(STRICT_IMG, STRICT_FRAME)
const OPEN_CSP = policy(OPEN_IMG, OPEN_FRAME)

/**
 * Stand-in written into the built HTML, replaced once per document.
 *
 * Going through a placeholder rather than emitting two documents separately is
 * what makes the guarantee cheap to state and impossible to lose: both files
 * come from the same bytes, so they are identical everywhere except inside this
 * one attribute. Two policies assembled independently would drift the first
 * time someone edited one of them.
 */
const CSP_PLACEHOLDER = '__NOOK_CSP__'

/**
 * The two documents.
 *
 * `index.html` is the promise: no picture from the web, no frame, and nothing
 * can loosen it. `open-web.html` allows both, and the application closes back,
 * at boot, whichever of the two the user has not turned on — see
 * `src/core/policy.ts` for why that direction is the only one that works.
 *
 * The relaxed document is only ever reached by turning on a setting, and the
 * address bar keeps saying which one is in force.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'nook:csp',

    // The relaxed document does not exist as a file during development, and
    // there is no policy in dev anyway. Serving the same application under that
    // address keeps the setting testable with `pnpm dev`.
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith(`/${OPEN_DOCUMENT}`)) request.url = '/index.html'
        next()
      })
    },

    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_PLACEHOLDER },
              injectTo: 'head-prepend',
            },
          ],
        }
      },
    },

    // `writeBundle` rather than `generateBundle`: the HTML has been through
    // every other plugin by then, and vite-plugin-pwa globs the output
    // directory from disk afterwards, so the second document is precached like
    // the first and the application still opens offline under either address.
    writeBundle(options) {
      const outDir = options.dir ?? 'dist'
      const template = readFileSync(join(outDir, STRICT_DOCUMENT), 'utf8')

      if (!template.includes(CSP_PLACEHOLDER)) {
        throw new Error(
          `The CSP placeholder is missing from ${STRICT_DOCUMENT}. The build would ship a document with no policy at all.`,
        )
      }

      writeFileSync(join(outDir, STRICT_DOCUMENT), template.replace(CSP_PLACEHOLDER, STRICT_CSP))
      writeFileSync(join(outDir, OPEN_DOCUMENT), template.replace(CSP_PLACEHOLDER, OPEN_CSP))
    },
  }
}

/**
 * Modules removed from the bundle because they emit network requests.
 *
 * Disabling them by configuration would not stop them being served; the
 * alias guarantees they do not exist in what the browser receives. See
 * `src/ui/editor/emoji-mart-absent.ts` for the full reasoning.
 */
const OFFLINE_STUB = new URL('./src/ui/editor/emoji-mart-absent.ts', import.meta.url).pathname

export default defineConfig({
  base: BASE,
  resolve: {
    alias: {
      'emoji-mart': OFFLINE_STUB,
      '@emoji-mart/data': OFFLINE_STUB,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Nook — local notes',
        short_name: 'Nook',
        description: 'Local-first note taking. Your data never leaves your machine.',
        lang: 'en',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0b0c0e',
        theme_color: '#0b0c0e',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything is precached: the application must start with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // No runtime caching: there is nothing to go and fetch.
        runtimeCaching: [],
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    // Vite's module-preload polyfill calls `fetch()` for
    // browsers without `modulepreload`. No target of this project needs it,
    // and we prefer a bundle where the word `fetch` appears nowhere.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
