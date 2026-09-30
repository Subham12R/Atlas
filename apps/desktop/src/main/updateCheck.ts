import type { UpdateResult } from '../shared/update'

export const RELEASES_API = 'https://api.github.com/repos/Subham12R/Atlas/releases/latest'
const TRUSTED_PREFIX = 'https://github.com/Subham12R/Atlas/'
const MAX_NOTES = 4000

interface GithubAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  html_url?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

/** [major, minor, patch] from "v1.2.3" or "1.2.3"; null for anything else (pre-release tags too). */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

function assetSuffix(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : '.AppImage'
}

function trustedUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith(TRUSTED_PREFIX) && !/\s/.test(value)
    ? value
    : null
}

export interface UpdateTargets {
  releaseUrl: string
  downloadUrl: string | null
}

/** Latest GitHub release vs. the running version. Only github.com/Subham12R/Atlas links are
 * ever returned as openable targets, whatever the API response says. */
export async function checkForUpdate(
  current: string,
  platform: NodeJS.Platform,
  fetchImpl: typeof fetch = fetch
): Promise<{ result: UpdateResult; targets: UpdateTargets | null }> {
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Atlas/${current}` },
      signal: AbortSignal.timeout(8000)
    })
    if (response.status === 404) return { result: { status: 'current', current }, targets: null }
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
    const release = (await response.json()) as GithubRelease
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    if (release.draft || release.prerelease || !parseVersion(tag)) {
      return { result: { status: 'current', current }, targets: null }
    }
    if (!isNewer(tag, current)) return { result: { status: 'current', current }, targets: null }
    const releaseUrl = trustedUrl(release.html_url)
    if (!releaseUrl) throw new Error('Release link was not a github.com/Subham12R/Atlas URL')
    const suffix = assetSuffix(platform)
    const asset = (Array.isArray(release.assets) ? (release.assets as GithubAsset[]) : []).find(
      (item) =>
        typeof item.name === 'string' &&
        item.name.endsWith(suffix) &&
        trustedUrl(item.browser_download_url)
    )
    const downloadUrl = asset ? trustedUrl(asset.browser_download_url) : null
    return {
      result: {
        status: 'available',
        current,
        latest: tag.replace(/^v/, ''),
        name: typeof release.name === 'string' && release.name ? release.name : tag,
        notes: typeof release.body === 'string' ? release.body.slice(0, MAX_NOTES) : '',
        publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
        hasDownload: !!downloadUrl
      },
      targets: { releaseUrl, downloadUrl }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update check failed'
    return {
      result: { status: 'error', current, message: `Could not check for updates: ${message}` },
      targets: null
    }
  }
}
