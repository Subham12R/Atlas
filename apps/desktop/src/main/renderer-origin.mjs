// The adjacent .d.mts provides this module's TypeScript return type.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function isTrustedRendererUrl(url, entryUrl) {
  try {
    const current = new URL(url)
    const entry = new URL(entryUrl)
    current.hash = ''
    entry.hash = ''
    return current.href === entry.href
  } catch {
    return false
  }
}
