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
  withinBounds,
} from '../official-http/mapping.js'
import type { ProviderJsonRequester } from '../official-http/provider-http.js'

const responseSchema = z.object({
  total: z.number().int().nonnegative().optional().default(0),
  items: z.array(z.unknown()),
})
const itemSchema = z.object({
  title: z.string(),
  link: z.string().optional().default(''),
  category: z.string().optional().default(''),
  address: z.string().optional().default(''),
  roadAddress: z.string().optional().default(''),
  mapx: z.union([z.string(), z.number()]),
  mapy: z.union([z.string(), z.number()]),
})

export type NaverOfficialSearchConfig = Readonly<{
  endpoint: URL
  clientId: string
  clientSecret: string
  timeoutMilliseconds: number
}>

function titleText(value: string): string | undefined {
  return visibleText(value
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'"), 300)
}

function coordinate(value: string | number, scale: number): number | undefined {
  const parsed = Number(value) / scale
  return Number.isFinite(parsed) ? parsed : undefined
}

export class NaverOfficialPlaceSearch implements ProviderPlaceSearch {
  readonly sourceKey = 'naver' as const
  readonly capabilities = {
    providerKey: 'naver',
    officialSearch: { maxPageSize: 5, pagination: 'none', bounds: 'client-filtered' },
    placeDetails: 'unsupported',
    placePhotos: 'unsupported',
  } as const

  constructor(
    private readonly config: NaverOfficialSearchConfig,
    private readonly requester: ProviderJsonRequester,
    private readonly now: () => Date = () => new Date(),
  ) {}

  accepts(query: ProviderSearchQuery): boolean {
    return unsupportedQuery(query) === undefined
  }

  async search(query: ProviderSearchQuery): Promise<ProviderSearchPage> {
    const unsupported = unsupportedQuery(query)
    if (unsupported !== undefined) return unsupported
    try {
      const url = new URL(this.config.endpoint)
      url.searchParams.set('query', query.query.trim())
      url.searchParams.set('display', String(Math.min(query.limit, 5)))
      url.searchParams.set('start', '1')
      url.searchParams.set('sort', 'random')
      const payload = responseSchema.parse(await this.requester.request({
        method: 'GET',
        url,
        headers: {
          'x-naver-client-id': this.config.clientId,
          'x-naver-client-secret': this.config.clientSecret,
          accept: 'application/json',
        },
        timeoutMilliseconds: this.config.timeoutMilliseconds,
      }))
      let invalidItems = 0
      const observedAt = this.now().toISOString()
      const items = payload.items.flatMap((raw) => {
        const parsed = itemSchema.safeParse(raw)
        if (!parsed.success) {
          invalidItems += 1
          return []
        }
        const name = titleText(parsed.data.title)
        const longitude = coordinate(parsed.data.mapx, 10_000_000)
        const latitude = coordinate(parsed.data.mapy, 10_000_000)
        if (
          name === undefined || longitude === undefined || latitude === undefined ||
          longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90
        ) {
          invalidItems += 1
          return []
        }
        const areaLabel = visibleText(
          parsed.data.roadAddress || parsed.data.address,
          300,
        ) ?? null
        const result = providerResult({
          providerKey: 'naver', providerLabel: 'NAVER 지도',
          name, areaLabel, latitude, longitude,
          ...(safeHttpUrl(parsed.data.link) === undefined
            ? {}
            : { externalUri: safeHttpUrl(parsed.data.link)! }),
          ...(visibleText(parsed.data.category, 300) === undefined
            ? {}
            : { categoryLabel: visibleText(parsed.data.category, 300)! }),
          detailsAvailable: false, observedAt,
        })
        return withinBounds(result.location, query) ? [result] : []
      })
      const limited = payload.total > payload.items.length
      return invalidItems === 0 && !limited
        ? { status: 'complete', items }
        : {
          status: 'partial', items,
          errorCode: invalidItems > 0
            ? 'PLACE_PROVIDER_RESPONSE_INVALID'
            : 'PLACE_PROVIDER_RESULT_LIMITED',
        }
    } catch (error) {
      return unavailablePage(error)
    }
  }
}
