// The adjacent .d.mts provides this module's TypeScript return type.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function isExternalWebUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}
