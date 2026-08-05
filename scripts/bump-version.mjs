#!/usr/bin/env node
/**
 * What the next version number is, read off the commits.
 *
 * A number nobody bumps is worse than no number: `0.1.0` printed in the
 * settings panel for a year would be an interface stating a falsehood with
 * confidence. So the release job in `.github/workflows/deploy.yml` runs this
 * before every deployment, and the number moves on its own.
 *
 * **Why this is thirty lines rather than a dependency.** `semantic-release` does
 * this and a great deal more — changelogs, releases, plugins — bringing some
 * forty transitive packages to a decision that fits on one screen. This
 * repository has settled that trade the same way before: it drives Chrome over
 * raw CDP rather than take a browser-testing library. The rule being followed
 * is that a dependency has to earn the audit surface it costs.
 *
 * **The convention.** Conventional Commits, on top of the sentence this project
 * already writes:
 *
 *     feat: Give Snapshot, Export and Share a key
 *     fix: Make `verify` run the check that turned CI red
 *     chore: Keep the files the tests download inside the project
 *
 * `feat` moves the minor, `fix` and `perf` the patch, a trailing `!` or a
 * `BREAKING CHANGE:` paragraph the major. Anything else moves nothing — a
 * commit touching only the README does not manufacture a version, and that
 * silence is a feature rather than an oversight.
 *
 * Usage:
 *
 *     node scripts/bump-version.mjs            # says what the next one would be
 *     node scripts/bump-version.mjs --write    # and writes it into package.json
 *
 * The version goes to stdout, and nothing goes to stdout when there is no
 * release — the workflow tests that emptiness. The reasoning goes to stderr,
 * where a person reading a log will find it.
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MANIFEST = new URL('../package.json', import.meta.url)

/** `type(scope)!:` at the head of a subject line. */
const SUBJECT = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:/i

/** The footer form, which is the other half of how a break is declared. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m

/**
 * The largest bump any of these messages asks for, or `null` for none.
 *
 * Deliberately not "the last one wins" or "the first one wins": a deployment
 * carries every commit since the previous one, and the version it publishes has
 * to cover the loudest thing in that batch.
 */
export function bumpFor(messages) {
  let bump = null

  for (const message of messages) {
    const match = SUBJECT.exec(message.trimStart())
    // No recognised prefix: not a claim about the release, so not counted. A
    // `BREAKING CHANGE:` body under an unprefixed subject is not a conventional
    // commit at all, and guessing at it would make the rule unlearnable.
    if (!match) continue

    if (match.groups.breaking || BREAKING_FOOTER.test(message)) return 'major'

    const type = match.groups.type.toLowerCase()
    if (type === 'feat') bump = 'minor'
    else if ((type === 'fix' || type === 'perf') && bump === null) bump = 'patch'
  }

  return bump
}

/**
 * The next version, or `null` when the commits ask for nothing.
 *
 * One rule is not plain arithmetic: while the major is `0`, a breaking change
 * moves the **minor**, not the major. Reaching 1.0.0 is a statement about a
 * project being ready to be depended upon, and it should be made by a person on
 * purpose rather than by a script noticing an exclamation mark.
 */
export function nextVersion(current, messages) {
  const bump = bumpFor(messages)
  if (!bump) return null

  const parts = current.split('.').map(Number)
  if (parts.length !== 3 || !parts.every(Number.isInteger)) {
    throw new Error(`"${current}" is not a version this script knows how to bump.`)
  }
  const [major, minor, patch] = parts

  if (bump === 'major') return major === 0 ? `${major}.${minor + 1}.0` : `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Substitutes the one value, rather than re-serialising the file.
 *
 * `JSON.parse` followed by `JSON.stringify` would reformat key order, spacing
 * and the trailing newline to whatever Node felt like, and `pnpm format:check`
 * compares all of that against Prettier on the next run. A bump has no business
 * turning CI red.
 */
export function withVersion(manifest, current, next) {
  const field = new RegExp(`("version"\\s*:\\s*")${current.replaceAll('.', String.raw`\.`)}(")`)
  if (!field.test(manifest)) {
    throw new Error(`No "version": "${current}" field found in package.json.`)
  }
  return manifest.replace(field, `$1${next}$2`)
}

function git(command) {
  return execSync(`git ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
}

/** The last release tag, or `null` on a repository that has never had one. */
function lastTag() {
  try {
    return git('describe --tags --abbrev=0 --match "v*"')
  } catch {
    return null
  }
}

function commitsSince(tag) {
  // A NUL between messages: a commit body contains blank lines, bullet points
  // and anything else somebody cared to type, so no printable separator is
  // safe to split on.
  return git(`log ${tag ? `${tag}..HEAD` : 'HEAD'} --format=%B%x00`)
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean)
}

function main() {
  const manifest = readFileSync(MANIFEST, 'utf8')
  const current = JSON.parse(manifest).version

  const tag = lastTag()
  const messages = commitsSince(tag)
  const next = nextVersion(current, messages)

  const since = tag ? `since ${tag}` : 'in the whole history (no release tag yet)'

  if (!next) {
    console.error(
      `No release: ${messages.length} commit(s) ${since}, none of them a feat, a fix or a break. Staying on ${current}.`,
    )
    return
  }

  if (process.argv.includes('--write')) {
    writeFileSync(MANIFEST, withVersion(manifest, current, next))
    console.error(`package.json: ${current} → ${next} (${messages.length} commit(s) ${since}).`)
  } else {
    console.error(`Would move ${current} → ${next} (${messages.length} commit(s) ${since}).`)
  }

  console.log(next)
}

// Imported by its test rather than run: nothing above this line touches the
// filesystem or the repository.
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
