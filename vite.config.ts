// `vitest/config` réexporte `defineConfig` de Vite en acceptant en plus la
// clé `test`, ce qui garde la configuration du projet dans un seul fichier.
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Sous-chemin où le site est servi. GitHub Pages sert un repo `nook` sur
 * `/nook/`. Un fork qui renomme le repo n'a que cette ligne à changer
 * (ou la variable d'environnement BASE).
 */
const BASE = process.env.BASE ?? '/nook/'

/**
 * Politique de sécurité du contenu.
 *
 * `connect-src 'none'` est le cœur de la promesse du produit : le navigateur
 * refuse toute requête sortante (fetch, XHR, WebSocket, EventSource, beacon).
 * Même si une dépendance tentait d'appeler un serveur, la page ne peut pas.
 *
 * Injectée uniquement dans le build de production : le serveur de dev a besoin
 * d'un WebSocket pour le rechargement à chaud.
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
 * Modules retirés du bundle parce qu'ils émettent des requêtes réseau.
 *
 * Les désactiver par configuration ne les empêcherait pas d'être servis ;
 * l'alias garantit qu'ils n'existent pas dans ce que le navigateur reçoit.
 * Voir `src/ui/editor/emoji-mart-absent.ts` pour le raisonnement complet.
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
        name: 'Nook — notes locales',
        short_name: 'Nook',
        description: 'Prise de notes local-first. Vos données ne quittent jamais votre machine.',
        lang: 'fr',
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
        // Tout est précaché : l'application doit démarrer sans réseau.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Aucune mise en cache d'exécution : il n'y a rien à aller chercher.
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
    // Le polyfill de préchargement de modules de Vite appelle `fetch()` pour
    // les navigateurs sans `modulepreload`. Aucune cible de ce projet n'en a
    // besoin, et on préfère un bundle où le mot `fetch` n'apparaît nulle part.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
