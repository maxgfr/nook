import { describe, expect, it } from 'vitest'
import {
  classifyUrl,
  documentFor,
  hostOf,
  isLocalUrl,
  looksLikeImage,
  NO_WEB_ACCESS,
  OPEN_DOCUMENT,
  OPEN_FRAME,
  OPEN_IMG,
  resolveEmbed,
  STRICT_DOCUMENT,
  STRICT_FRAME,
  STRICT_IMG,
  tighteningFor,
} from './policy'

describe('the policy to insert at boot', () => {
  it('closes both doors when nothing is turned on', () => {
    expect(tighteningFor(NO_WEB_ACCESS)).toBe(`${STRICT_IMG}; ${STRICT_FRAME}`)
  })

  it('names only what stays closed', () => {
    // The point of naming one directive: everything omitted stays governed by
    // the document's own policy, so one relaxed document serves every
    // combination of settings.
    expect(tighteningFor({ remoteImages: true, externalEmbeds: false })).toBe(STRICT_FRAME)
    expect(tighteningFor({ remoteImages: false, externalEmbeds: true })).toBe(STRICT_IMG)
  })

  it('inserts nothing when both are on', () => {
    expect(tighteningFor({ remoteImages: true, externalEmbeds: true })).toBeNull()
  })

  it('never mentions connect-src, in any combination', () => {
    // `connect-src 'none'` lives in both documents and is not a setting. If it
    // ever appeared here it would mean someone had made it one.
    for (const remoteImages of [false, true]) {
      for (const externalEmbeds of [false, true]) {
        expect(tighteningFor({ remoteImages, externalEmbeds }) ?? '').not.toContain('connect-src')
      }
    }
  })
})

describe('choosing the document', () => {
  it('stays strict when nothing is asked for', () => {
    expect(documentFor(NO_WEB_ACCESS)).toBe(STRICT_DOCUMENT)
  })

  it.each([
    { remoteImages: true, externalEmbeds: false },
    { remoteImages: false, externalEmbeds: true },
    { remoteImages: true, externalEmbeds: true },
  ])('moves to the open document for %o', (access) => {
    expect(documentFor(access)).toBe(OPEN_DOCUMENT)
  })
})

describe('the two documents’ directives', () => {
  it('open the image directive only to https', () => {
    // Not `*`: `http:` would allow a picture to be read, and altered, by
    // anyone on the path.
    expect(OPEN_IMG).toBe("img-src 'self' data: blob: https:")
    expect(OPEN_IMG.startsWith(STRICT_IMG)).toBe(true)
  })

  it('open frames to a closed list of hosts, never to https at large', () => {
    expect(OPEN_FRAME).not.toContain('https:;')
    expect(OPEN_FRAME).toContain('https://www.youtube-nocookie.com')
    expect(OPEN_FRAME).toContain('https://player.vimeo.com')
    // youtube.com sets its tracking cookies before playback; the -nocookie
    // host does not. Choosing the worse one for free would be careless.
    expect(OPEN_FRAME).not.toContain('https://www.youtube.com')
  })
})

describe('resolving a page address to a player address', () => {
  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    ['https://youtube.com/watch?v=abc123&t=42', 'https://www.youtube-nocookie.com/embed/abc123'],
    ['https://youtu.be/abc123', 'https://www.youtube-nocookie.com/embed/abc123'],
    ['https://youtu.be/abc123?t=9', 'https://www.youtube-nocookie.com/embed/abc123'],
    ['https://www.youtube.com/embed/abc123', 'https://www.youtube-nocookie.com/embed/abc123'],
    [
      'https://www.youtube-nocookie.com/embed/abc123',
      'https://www.youtube-nocookie.com/embed/abc123',
    ],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871'],
  ])('%s', (url, embedUrl) => {
    expect(resolveEmbed(url)?.embedUrl).toBe(embedUrl)
  })

  it('rewrites every YouTube address to the no-cookie host', () => {
    expect(resolveEmbed('https://www.youtube.com/watch?v=x')?.embedUrl).toContain('nocookie')
  })

  describe('refusing to guess', () => {
    it.each([
      ['a provider that is not on the list', 'https://dailymotion.com/video/x123'],
      ['a YouTube page carrying no video', 'https://www.youtube.com/feed/subscriptions'],
      ['a Vimeo path that is not an id', 'https://vimeo.com/channels/staffpicks'],
      ['plain http, even on a listed host', 'http://www.youtube.com/watch?v=abc'],
      ['something that is not a URL at all', 'not a url'],
      ['an empty string', ''],
    ])('%s', (_why, url) => {
      // A frame pointing at nothing fails silently, and looks like a bug in Nook.
      expect(resolveEmbed(url)).toBeNull()
    })
  })
})

describe('telling apart what is ours from what is not', () => {
  it.each([
    'nook:abc-123',
    'data:image/png;base64,AAAA',
    'blob:http://x/y',
    './local.png',
    '/nook/x.png',
  ])('%s never leaves the machine', (url) => {
    expect(isLocalUrl(url)).toBe(true)
  })

  it.each(['https://example.com/a.png', 'http://example.com/a.png'])('%s does', (url) => {
    expect(isLocalUrl(url)).toBe(false)
  })

  it('recognises picture addresses by extension', () => {
    expect(looksLikeImage('https://example.com/photo.JPG')).toBe(true)
    expect(looksLikeImage('https://example.com/a/b.webp?w=200')).toBe(true)
    expect(looksLikeImage('https://example.com/article')).toBe(false)
  })

  it.each([
    ['local', 'nook:abc'],
    ['frame', 'https://youtu.be/abc123'],
    ['image', 'https://example.com/photo.png'],
    ['link', 'https://example.com/article'],
  ])('classifies as %s', (kind, url) => {
    expect(classifyUrl(url)).toBe(kind)
  })
})

describe('naming the host', () => {
  it('gives the name someone would recognise', () => {
    expect(hostOf('https://images.example.com/a.png')).toBe('images.example.com')
  })

  it('falls back to the address itself rather than to nothing', () => {
    // This string goes into a sentence telling someone who they would be
    // telling. An empty host would produce "would tell  that you are reading".
    expect(hostOf('nonsense')).toBe('nonsense')
  })
})
