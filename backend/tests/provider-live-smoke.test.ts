import { describe, expect, it } from 'vitest'

import { loadOfficialProviderConfig } from '../src/entrypoints/http/config.js'
import {
  GoogleOfficialPlaceSearch,
  KakaoOfficialPlaceSearch,
  NaverOfficialPlaceSearch,
  OfficialProviderHttpClient,
  type ProviderPlaceSearch,
} from '../src/modules/providers/index.js'

const liveEnabled = process.env.PLACE_PROVIDER_LIVE_SMOKE === '1'

describe.skipIf(!liveEnabled)('official provider live smoke', () => {
  it('classifies every explicitly configured official search source', async () => {
    const query = process.env.PLACE_PROVIDER_LIVE_QUERY?.trim()
    if (query === undefined || query === '') {
      throw new Error('PLACE_PROVIDER_LIVE_QUERY is required for live smoke')
    }
    const config = await loadOfficialProviderConfig(process.env)
    if (config === undefined) throw new Error('At least one provider group is required')
    const requester = new OfficialProviderHttpClient()
    const sources: ProviderPlaceSearch[] = [
      ...(config.naver === undefined ? [] : [new NaverOfficialPlaceSearch(config.naver, requester)]),
      ...(config.kakao === undefined ? [] : [new KakaoOfficialPlaceSearch(config.kakao, requester)]),
      ...(config.google === undefined ? [] : [new GoogleOfficialPlaceSearch(config.google, requester)]),
    ]

    const pages = await Promise.all(sources.map((source) => source.search({
      query, filters: { taxonomyKeys: [] }, limit: 3,
    })))

    expect(pages).toHaveLength(sources.length)
    for (const page of pages) expect(page.status).not.toBe('unavailable')
  })
})
