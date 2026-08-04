// `vitest/config` re-exports Vite's `defineConfig` while also accepting the
// `test` key, which keeps the project's configuration in a single file.
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'nook:csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
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
