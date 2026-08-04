/**
 * Hands a file to the browser without touching the network.
 *
 * A `blob:` URL is same-origin by construction, so the policy that forbids
 * every outgoing request has nothing to object to — the bytes never leave the
 * tab. This is how every file Nook produces gets out: the export, a page as
 * Markdown, a shared page.
 *
 * One function rather than three near-copies. It was already duplicated between
 * the settings dialog and the editor, and a third caller is what makes that
 * indefensible.
 */
export function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * A page title made safe to be a filename.
 *
 * Deliberately blunt: everything that is not a letter, a digit, a dot or a dash
 * becomes a dash. Titles can hold slashes and colons, which mean something to
 * a filesystem and nothing good.
 */
export function fileNameFrom(title: string, fallback: string, extension: string): string {
  const stem = (title.trim() === '' ? fallback : title).replaceAll(/[^\w.-]+/gu, '-')
  return `${stem}${extension}`
}
