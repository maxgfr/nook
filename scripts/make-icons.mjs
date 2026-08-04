#!/usr/bin/env node
/**
 * Generates the application's PNGs from the SVG mark.
 *
 * No rasterisation library is added to the project for this: we borrow the
 * rendering engine of a browser that is already installed, for the length of
 * one screenshot. The script is only run by hand, when the mark changes — the
 * PNGs it produces are committed, so neither CI nor a contributor needs
 * Chrome to build the project.
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
  console.error('✖ No Chromium browser found to rasterise the icons.')
  console.error('  The existing PNGs are committed: this script only regenerates them.')
  process.exit(1)
}

/**
 * `safe` reserves a margin around the mark. Android crops "maskable" icons
 * to a shape it picks itself; without that margin, the corners of the square
 * would be cut off.
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
