/**
 * Copying a picture from the web into the vault, once.
 *
 * The point of this file is to turn a page that depends on someone else's
 * server into a page that does not. A note holding a `nook:` reference works
 * offline, survives the host deleting the file, travels inside an export or a
 * shared bundle, and stops telling that host when it is being read. A note
 * holding an `https:` reference does none of those things.
 *
 * **Why a canvas and not a fetch.** `connect-src 'none'` is not a setting, in
 * either document: the page cannot issue a request in code, ever. What the
 * "pictures from the web" switch changes is `img-src`, which governs how the
 * *browser* loads an `<img>`. So the only way to get at the bytes is to let the
 * browser load the image and then read the pixels back out.
 *
 * That has two consequences worth stating rather than hiding:
 *
 * - **The host must allow it.** Reading pixels back from an image loaded from
 *   another origin is forbidden unless that origin sends CORS headers saying it
 *   is fine. Plenty do not. When that happens the canvas is "tainted" and the
 *   read throws — which is the honest signal that this picture cannot be made
 *   local, and the caller says so instead of failing quietly.
 * - **It is a re-encode, not a copy.** What comes back is what the browser
 *   painted: PNG, one frame, no metadata. An animation loses its animation.
 *   Lossless for what it keeps, but it is not the original file.
 */

/** Long enough for a slow host, short enough that nobody wonders if it hung. */
const TIMEOUT_MS = 15_000

export class RemoteImageError extends Error {
  override readonly name = 'RemoteImageError'
}

export type CopiedImage = { readonly bytes: Uint8Array; readonly type: string }

export async function copyRemoteImage(url: string): Promise<CopiedImage> {
  const image = await load(url)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight

  if (canvas.width === 0 || canvas.height === 0) {
    throw new RemoteImageError('That address did not turn out to be a picture.')
  }

  const context = canvas.getContext('2d')
  if (!context) throw new RemoteImageError('This browser would not give Nook a canvas to draw on.')
  context.drawImage(image, 0, 0)

  const blob = await toBlob(canvas)
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Asks the host for permission to read the pixels back. Without it the
    // canvas is tainted even when the host would have allowed it.
    image.crossOrigin = 'anonymous'

    const timer = setTimeout(() => {
      reject(new RemoteImageError('That host did not answer.'))
    }, TIMEOUT_MS)

    image.addEventListener(
      'load',
      () => {
        clearTimeout(timer)
        resolve(image)
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        // Two very different causes land here and the browser does not let us
        // tell them apart: the policy refused the load, or the host refused
        // anonymous access. Both mean the same thing for the user.
        reject(
          new RemoteImageError(
            'Nook could not load that picture — either the setting is off, or the host refused.',
          ),
        )
      },
      { once: true },
    )

    image.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new RemoteImageError('The picture could not be encoded.'))
      }, 'image/png')
    } catch {
      // A `SecurityError`: the canvas is tainted because the host sent no CORS
      // header. This is the common failure, and the one with a real answer for
      // the user — keep the link, and accept what that costs.
      reject(
        new RemoteImageError(
          'That host does not let Nook copy the picture. It can only be shown by asking the host for it each time.',
        ),
      )
    }
  })
}
