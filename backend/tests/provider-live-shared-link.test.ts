import { expect, it } from 'vitest'

import {
  NaverSharedListSource,
  PinnedNaverHttpsClient,
} from '../src/modules/providers/index.js'

const sharedLink = process.env.PLACE_NAVER_SHARED_LINK_LIVE_URL?.trim()

it.runIf(sharedLink !== undefined && sharedLink !== '')(
  'reads one explicitly supplied public NAVER shared list without an account session',
  { timeout: 45_000 },
  async () => {
    const requester = new PinnedNaverHttpsClient()
    const probe = await requester.get({
      url: new URL(sharedLink!),
      maximumBytes: 32 * 1024,
      timeoutMilliseconds: 8_000,
      signal: AbortSignal.timeout(10_000),
    })
    expect([301, 302, 303, 307, 308]).toContain(probe.status)
    const source = new NaverSharedListSource(requester)
    const result = await source.inspect({
      entries: [{ entryId: crypto.randomUUID(), position: 0, url: sharedLink! }],
      signal: AbortSignal.timeout(40_000),
    })

    expect(result).toHaveLength(1)
    if (result[0]?.status !== 'succeeded') {
      throw new Error(`NAVER shared link smoke failed safely: ${result[0]?.status === 'failed' ? result[0].code : 'duplicate'}`)
    }
    expect(result[0].list.observedName.length).toBeGreaterThan(0)
    expect(result[0].list.items.length).toBeGreaterThan(0)
    expect(result[0].inputUrlDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result)).not.toContain(sharedLink)
  },
)
