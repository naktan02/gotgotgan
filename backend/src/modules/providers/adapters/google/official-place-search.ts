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

const localizedTextSchema = z.object({ text: z.string() })
const placeSchema = z.object({
  id: z.string().min(1),
  displayName: localizedTextSchema,
  formattedAddress: z.string().optional().default(''),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  primaryTypeDisplayName: localizedTextSchema.optional(),
  googleMapsUri: z.string().optional().default(''),
})
const responseSchema = z.object({
  places: z.array(z.unknown()).optional().default([]),
  nextPageToken: z.string().min(1).optional(),
})

export type GoogleOfficialPlacesConfig = Readonly<{
  baseUrl: URL
  apiKey: string
  timeoutMilliseconds: number
}>

const searchFieldMask = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'nextPageToken',
].join(',')

export class GoogleOfficialPlaceSearch implements ProviderPlaceSearch {
  readonly sourceKey = 'google' as const
  readonly capabilities = {
    providerKey: 'google',
    officialSearch: { maxPageSize: 20, pagination: 'token', bounds: 'server-rectangle' },
    placeDetails: 'supported',
    placePhotos: 'supported',
  } as const

  constructor(
    private readonly config: GoogleOfficialPlacesConfig,
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
      const body = {
        textQuery: query.query.trim(),
        pageSize: Math.min(query.limit, 20),
        ...(query.cursor === undefined ? {} : { pageToken: query.cursor }),
        ...(query.bounds === undefined ? {} : {
          locationRestriction: {
            rectangle: {
              low: { latitude: query.bounds.south, longitude: query.bounds.west },
              high: { latitude: query.bounds.north, longitude: query.bounds.east },
            },
          },
        }),
      }
      const payload = responseSchema.parse(await this.requester.request({
        method: 'POST',
        url: new URL('./places:searchText', this.config.baseUrl),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.apiKey,
          'x-goog-fieldmask': searchFieldMask,
        },
        body,
        timeoutMilliseconds: this.config.timeoutMilliseconds,
      }))
      let invalidItems = 0
      const observedAt = this.now().toISOString()
      const items = payload.places.flatMap((raw) => {
        const parsed = placeSchema.safeParse(raw)
        if (!parsed.success) {
          invalidItems += 1
          return []
        }
        const name = visibleText(parsed.data.displayName.text, 300)
        const { latitude, longitude } = parsed.data.location
        if (
          name === undefined || latitude < -90 || latitude > 90 ||
          longitude < -180 || longitude > 180
        ) {
          invalidItems += 1
          return []
        }
        return [providerResult({
          providerKey: 'google', providerLabel: 'Google Maps',
          providerPlaceId: parsed.data.id, name,
          areaLabel: visibleText(parsed.data.formattedAddress, 300) ?? null,
          latitude, longitude,
          ...(safeHttpUrl(parsed.data.googleMapsUri) === undefined
            ? {}
            : { externalUri: safeHttpUrl(parsed.data.googleMapsUri)! }),
          ...(parsed.data.primaryTypeDisplayName === undefined ||
            visibleText(parsed.data.primaryTypeDisplayName.text, 300) === undefined
            ? {}
            : { categoryLabel: visibleText(parsed.data.primaryTypeDisplayName.text, 300)! }),
          detailsAvailable: true, observedAt,
        })]
      })
      return {
        status: invalidItems === 0 ? 'complete' : 'partial',
        items,
        ...(payload.nextPageToken === undefined ? {} : { nextCursor: payload.nextPageToken }),
        ...(invalidItems === 0 ? {} : { errorCode: 'PLACE_PROVIDER_RESPONSE_INVALID' }),
      }
    } catch (error) {
      return unavailablePage(error)
    }
  }
}
