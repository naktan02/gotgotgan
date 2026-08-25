import { createHash } from 'node:crypto'

import { z } from 'zod'

import type {
  ProviderPlaceSearch,
  ProviderPlaceSuggestions,
  ProviderSearchPage,
  ProviderSearchQuery,
  ProviderSuggestionBatch,
  ProviderSuggestionQuery,
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
const autocompleteResponseSchema = z.object({
  suggestions: z.array(z.unknown()).optional().default([]),
})
const autocompleteSuggestionSchema = z.object({
  placePrediction: z.object({
    placeId: z.string().min(1),
    text: localizedTextSchema,
    structuredFormat: z.object({
      mainText: localizedTextSchema,
      secondaryText: localizedTextSchema.optional(),
    }).optional(),
    types: z.array(z.string()).optional().default([]),
  }),
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

function providerSessionToken(sessionId: string): string {
  const hex = createHash('sha256').update(`place-google-autocomplete-v1:${sessionId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export class GoogleOfficialPlaceSearch implements ProviderPlaceSearch, ProviderPlaceSuggestions {
  readonly sourceKey = 'google' as const
  readonly capabilities = {
    providerKey: 'google',
    placeSuggestions: 'documented',
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

  async suggest(query: ProviderSuggestionQuery): Promise<ProviderSuggestionBatch> {
    if (query.query.trim() === '') return { status: 'complete', items: [] }
    try {
      const payload = autocompleteResponseSchema.parse(await this.requester.request({
        method: 'POST',
        url: new URL('./places:autocomplete', this.config.baseUrl),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.apiKey,
        },
        body: {
          input: query.query.trim(),
          sessionToken: providerSessionToken(query.sessionId),
          includeQueryPredictions: false,
          ...(query.language === undefined ? {} : { languageCode: query.language }),
          ...(query.bounds === undefined ? {} : {
            locationBias: {
              rectangle: {
                low: { latitude: query.bounds.south, longitude: query.bounds.west },
                high: { latitude: query.bounds.north, longitude: query.bounds.east },
              },
            },
          }),
        },
        timeoutMilliseconds: this.config.timeoutMilliseconds,
      }))
      let invalidItems = 0
      const observedAt = this.now().toISOString()
      const items = payload.suggestions.slice(0, query.limit).flatMap((raw) => {
        const parsed = autocompleteSuggestionSchema.safeParse(raw)
        if (!parsed.success) {
          invalidItems += 1
          return []
        }
        const prediction = parsed.data.placePrediction
        const name = visibleText(
          prediction.structuredFormat?.mainText.text ?? prediction.text.text,
          300,
        )
        if (name === undefined) {
          invalidItems += 1
          return []
        }
        const areaLabel = prediction.structuredFormat?.secondaryText === undefined
          ? null
          : visibleText(prediction.structuredFormat.secondaryText.text, 300) ?? null
        const categoryLabel = prediction.types[0]?.replaceAll('_', ' ') ?? null
        return [{
          candidateKey: `google:${prediction.placeId}`,
          identity: {
            kind: 'provider' as const,
            providerKey: 'google' as const,
            providerPlaceId: prediction.placeId,
          },
          source: {
            key: 'google', label: 'Google Maps', detailsAvailable: true,
            attributions: [{ label: 'Google Maps' }],
          },
          name,
          areaLabel,
          location: null,
          categoryLabel,
          observedAt,
        }]
      })
      return invalidItems === 0
        ? { status: 'complete', items }
        : { status: 'partial', items, errorCode: 'PLACE_PROVIDER_RESPONSE_INVALID' }
    } catch (error) {
      const unavailable = unavailablePage(error)
      return {
        status: unavailable.status,
        items: [],
        ...(unavailable.errorCode === undefined ? {} : { errorCode: unavailable.errorCode }),
      }
    }
  }
}
