import { describe, expect, it } from 'vitest'
import { checkForUpdate, isNewer, parseVersion } from './updateCheck'

const release = (over: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      tag_name: 'v1.0.7',
      name: 'Atlas 1.0.7',
      body: 'Notes',
      html_url: 'https://github.com/Subham12R/Atlas/releases/tag/v1.0.7',
      published_at: '2026-10-01T00:00:00Z',
      assets: [
        {
          name: 'Atlas-1.0.7-macos-arm64.dmg',
          browser_download_url:
            'https://github.com/Subham12R/Atlas/releases/download/v1.0.7/Atlas-1.0.7-macos-arm64.dmg'
        },
        {
          name: 'SHA256SUMS',
          browser_download_url:
            'https://github.com/Subham12R/Atlas/releases/download/v1.0.7/SHA256SUMS'
        }
      ],
      ...over
    }),
    { status: 200 }
  )

describe('version comparison', () => {
  it('parses plain and v-prefixed versions only', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.0.10')).toEqual([1, 0, 10])
    expect(parseVersion('1.0.7-beta.1')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })
  it('compares numerically, not lexically', () => {
    expect(isNewer('v1.0.10', '1.0.9')).toBe(true)
    expect(isNewer('1.0.6', '1.0.6')).toBe(false)
    expect(isNewer('1.0.5', '1.0.6')).toBe(false)
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
  })
})

describe('checkForUpdate', () => {
  it('reports a newer release with a platform download', async () => {
    const { result, targets } = await checkForUpdate('1.0.6', 'darwin', async () => release())
    expect(result).toMatchObject({
      status: 'available',
      latest: '1.0.7',
      hasDownload: true,
      notes: 'Notes'
    })
    expect(targets?.downloadUrl).toMatch(/\.dmg$/)
  })
  it('is current when the release is not newer, is a draft or a pre-release, or does not exist', async () => {
    expect((await checkForUpdate('1.0.7', 'darwin', async () => release())).result.status).toBe(
      'current'
    )
    expect(
      (await checkForUpdate('1.0.6', 'darwin', async () => release({ prerelease: true }))).result
        .status
    ).toBe('current')
    expect(
      (await checkForUpdate('1.0.6', 'darwin', async () => release({ draft: true }))).result.status
    ).toBe('current')
    expect(
      (await checkForUpdate('1.0.6', 'darwin', async () => new Response('', { status: 404 })))
        .result.status
    ).toBe('current')
  })
  it('never returns links outside the Atlas repository', async () => {
    const { result } = await checkForUpdate('1.0.6', 'darwin', async () =>
      release({ html_url: 'https://evil.example/releases/tag/v1.0.7' })
    )
    expect(result.status).toBe('error')
    const { targets } = await checkForUpdate('1.0.6', 'darwin', async () =>
      release({
        assets: [{ name: 'Atlas.dmg', browser_download_url: 'https://evil.example/Atlas.dmg' }]
      })
    )
    expect(targets?.downloadUrl).toBeNull()
  })
  it('turns network and HTTP failures into an error result', async () => {
    expect(
      (
        await checkForUpdate('1.0.6', 'darwin', async () => {
          throw new Error('offline')
        })
      ).result
    ).toMatchObject({ status: 'error' })
    expect(
      (await checkForUpdate('1.0.6', 'darwin', async () => new Response('', { status: 403 })))
        .result
    ).toMatchObject({ status: 'error' })
  })
})
