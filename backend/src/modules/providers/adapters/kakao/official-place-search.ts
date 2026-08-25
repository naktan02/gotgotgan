import { z } from 'zod'

import type {
  ProviderPlaceSearch,
  ProviderSearchPage,
  ProviderSearchQuery,
} from '../../domain/model.js'
import {
  providerResult,
  safeHttpUrl,
  unavailablePage,
  unsupportedQuery,
  visibleText,
} from '../official-http/mapping.js'
import type { ProviderJsonRequester } from '../official-http/provider-http.js'

const responseSchema = z.object({
  meta: z.object({
    total_count: z.number().int().nonnegative(),
    pageable_count: z.number().int().nonnegative(),
    is_end: z.boolean(),
  }),
  documents: z.array(z.unknown()),
})
const documentSchema = z.object({
  id: z.string().min(1),
  place_name: z.string(),
  category_name: z.string().optional().default(''),
  address_name: z.string().optional().default(''),
  road_address_name: z.string().optional().default(''),
  x: z.string(),
  y: z.string(),
  place_url: z.string().optional().default(''),
})

export type KakaoOfficialSearchConfig = Readonly<{
  endpoint: URL
  restApiKey: string
  timeoutMilliseconds: number
}>

function pageNumber(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return 1
  if (!/^\d+$/.test(cursor)) return undefined
  const value = Number(cursor)
  return Number.isInteger(value) && value >= 1 && value <= 45 ? value : undefined
}

export class KakaoOfficialPlaceSearch implements ProviderPlaceSearch {
  readonly sourceKey = 'kakao' as const
  readonly capabilities = {
    providerKey: 'kakao',
    officialSearch: { maxPageSize: 15, pagination: 'page', bounds: 'server-rectangle' },
    placeDetails: 'unsupported',
    placePhotos: 'unsupported',
  } as const

  constructor(
    private readonly config: KakaoOfficialSearchConfig,
    private readonly requester: ProviderJsonRequester,
    private readonly now: () => Date = () => new Date(),
  ) {}

  accepts(query: ProviderSearchQuery): boolean {
    return unsupportedQuery(query) === undefined
  }

  async search(query: ProviderSearchQuery): Promise<ProviderSearchPage> {
    const unsupported = unsupportedQuery(query)
    if (unsupported !== undefined) return unsupported
    const page = pageNumber(query.cursor)
    if (page === undefined) {
      return { status: 'unavailable', items: [], errorCode: 'PLACE_PROVIDER_CURSOR_INVALID' }
    }
    try {
      const url = new URL(this.config.endpoint)
      url.searchParams.set('query', query.query.trim())
      url.searchParams.set('size', String(Math.min(query.limit, 15)))
      url.searchParams.set('page', String(page))
      url.searchParams.set('sort', 'accuracy')
      if (query.bounds !== undefined) {
        url.searchParams.set('rect', [
          query.bounds.west, query.bounds.south, query.bounds.east, query.bounds.north,
        ].join(','))
      }
      const payload = responseSchema.parse(await this.requester.request({
        method: 'GET',
        url,
        headers: {
          authorization: `KakaoAK ${this.config.restApiKey}`,
          accept: 'application/json',
        },
        timeoutMilliseconds: this.config.timeoutMilliseconds,
      }))
      let invalidItems = 0
      const observedAt = this.now().toISOString()
      const items = payload.documents.flatMap((raw) => {
        const parsed = documentSchema.safeParse(raw)
        if (!parsed.success) {
          invalidItems += 1
          return []
        }
        const name = visibleText(parsed.data.place_name, 300)
        const latitude = Number(parsed.data.y)
        const longitude = Number(parsed.data.x)
        if (
          name === undefined || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
        ) {
          invalidItems += 1
          return []
        }
        return [providerResult({
          providerKey: 'kakao', providerLabel: '카카오맵',
          providerPlaceId: parsed.data.id, name,
          areaLabel: visibleText(
            parsed.data.road_address_name || parsed.data.address_name,
            300,
          ) ?? null,
          latitude, longitude,
          ...(safeHttpUrl(parsed.data.place_url) === undefined
            ? {}
            : { externalUri: safeHttpUrl(parsed.data.place_url)! }),
          ...(visibleText(parsed.data.category_name, 300) === undefined
            ? {}
            : { categoryLabel: visibleText(parsed.data.category_name, 300)! }),
          detailsAvailable: false, observedAt,
        })]
      })
      const limited = payload.meta.total_count > payload.meta.pageable_count
      return {
        status: invalidItems === 0 && !limited ? 'complete' : 'partial',
        items,
        ...(!payload.meta.is_end && page < 45 ? { nextCursor: String(page + 1) } : {}),
        ...(invalidItems > 0
          ? { errorCode: 'PLACE_PROVIDER_RESPONSE_INVALID' }
          : limited ? { errorCode: 'PLACE_PROVIDER_RESULT_LIMITED' } : {}),
      }
    } catch (error) {
      return unavailablePage(error)
    }
  }
}
