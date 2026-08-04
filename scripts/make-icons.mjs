#!/usr/bin/env node
/**
 * Génère les PNG de l'application à partir de la marque SVG.
 *
 * Aucune bibliothèque de rastérisation n'est ajoutée au projet pour ça : on
 * emprunte le moteur de rendu d'un navigateur déjà installé, le temps d'une
 * capture. Le script n'est lancé qu'à la main, quand la marque change — les
 * PNG produits sont versionnés, donc ni la CI ni un contributeur n'ont besoin
 * de Chrome pour construire le projet.
 *
 *   node scripts/make-icons.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PUBLIC = new URL('../public/', import.meta.url).pathname

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const chrome = CHROME_CANDIDATES.find((path) => existsSync(path))
if (!chrome) {
  console.error('✖ Aucun navigateur Chromium trouvé pour rastériser les icônes.')
  console.error('  Les PNG existants sont versionnés : ce script ne sert qu’à les régénérer.')
  process.exit(1)
}

/**
 * `safe` réserve une marge autour de la marque. Android rogne les icônes
 * « maskable » selon une forme qu'il choisit lui-même ; sans cette marge, les
 * angles du carré seraient coupés.
 */
const ICONS = [
  { file: 'pwa-192.png', size: 192, safe: 0 },
  { file: 'pwa-512.png', size: 512, safe: 0 },
  { file: 'pwa-maskable-512.png', size: 512, safe: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, safe: 0 },
]

const MARK = `<rect width="256" height="256" rx="58" fill="#a8502c"/>
  <path d="M82 196V140a46 46 0 0 1 92 0v56" fill="none" stroke="#faf8f5" stroke-width="28" stroke-linecap="round"/>`

const work = mkdtempSync(join(tmpdir(), 'nook-icons-'))

try {
  for (const icon of ICONS) {
    const pad = Math.round(256 * icon.safe)
    const box = 256 + pad * 2
    const page = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}" viewBox="${-pad} ${-pad} ${box} ${box}">
  ${icon.safe > 0 ? `<rect x="${-pad}" y="${-pad}" width="${box}" height="${box}" fill="#a8502c"/>` : ''}
  ${MARK}
</svg>`

    const html = join(work, `${icon.file}.html`)
    writeFileSync(html, page)

    execFileSync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${icon.size},${icon.size}`,
        `--screenshot=${join(work, icon.file)}`,
        `file://${html}`,
      ],
      { stdio: 'ignore' },
    )

    copyFileSync(join(work, icon.file), join(PUBLIC, icon.file))
    console.log(`✔ ${icon.file} (${icon.size}×${icon.size})`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
