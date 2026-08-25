import { z } from 'zod'

import {
  ProviderDetailUnsupportedError,
  type ProviderAttribution,
  type ProviderPlaceDetail,
  type ProviderPlaceDetailRequest,
  type ProviderPlaceDetails,
} from '../../domain/model.js'
import { safeHttpUrl, visibleText } from '../official-http/mapping.js'
import type { GoogleOfficialPlacesConfig } from './official-place-search.js'
import {
  ProviderRequestFailure,
  type ProviderJsonRequester,
} from '../official-http/provider-http.js'

const localizedTextSchema = z.object({ text: z.string() })
const attributionSchema = z.object({
  displayName: z.string(),
  uri: z.string().optional(),
})
const photoSchema = z.object({
  name: z.string(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  authorAttributions: z.array(attributionSchema).optional().default([]),
})
const detailSchema = z.object({
  id: z.string().min(1),
  displayName: localizedTextSchema,
  formattedAddress: z.string().optional().default(''),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  primaryTypeDisplayName: localizedTextSchema.optional(),
  googleMapsUri: z.string().optional().default(''),
  nationalPhoneNumber: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().nonnegative().optional(),
  businessStatus: z.string().optional(),
  currentOpeningHours: z.object({
    openNow: z.boolean().optional(),
    weekdayDescriptions: z.array(z.string()).optional().default([]),
  }).optional(),
  photos: z.array(photoSchema).optional().default([]),
})
const photoMediaSchema = z.object({ photoUri: z.string() })

const detailsFieldMask = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'primaryTypeDisplayName',
  'googleMapsUri',
  'nationalPhoneNumber',
  'rating',
  'userRatingCount',
  'businessStatus',
  'currentOpeningHours',
  'photos',
].join(',')

function photoResourcePath(value: string): string | undefined {
  return /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(value)
    ? value
    : undefined
}

function authorAttributions(
  values: readonly z.infer<typeof attributionSchema>[],
): readonly ProviderAttribution[] {
  return values.flatMap((value) => {
    const label = visibleText(value.displayName, 200)
    if (label === undefined) return []
    const uri = safeHttpUrl(value.uri)
    return [{ label, ...(uri === undefined ? {} : { uri }) }]
  })
}

export class GoogleOfficialPlaceDetails implements ProviderPlaceDetails {
  readonly providerKey = 'google' as const

  constructor(
    private readonly config: GoogleOfficialPlacesConfig,
    private readonly requester: ProviderJsonRequester,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(request: ProviderPlaceDetailRequest): Promise<ProviderPlaceDetail> {
    if (request.providerKey !== 'google') {
      throw new ProviderDetailUnsupportedError('Provider details are unsupported.')
    }
    const payload = detailSchema.parse(await this.requester.request({
      method: 'GET',
      url: new URL(`places/${encodeURIComponent(request.providerPlaceId)}`, this.config.baseUrl),
      headers: {
        'x-goog-api-key': this.config.apiKey,
        'x-goog-fieldmask': detailsFieldMask,
        accept: 'application/json',
      },
      timeoutMilliseconds: this.config.timeoutMilliseconds,
    }))
    const name = visibleText(payload.displayName.text, 300)
    if (payload.id !== request.providerPlaceId || name === undefined) {
      throw new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID')
    }
    const firstPhoto = payload.photos[0]
    const photoPath = firstPhoto === undefined
      ? undefined
      : photoResourcePath(firstPhoto.name)
    let mediaUri: string | undefined
    if (photoPath !== undefined) {
      try {
        const url = new URL(`${photoPath}/media`, this.config.baseUrl)
        url.searchParams.set('maxWidthPx', '800')
        url.searchParams.set('maxHeightPx', '600')
        url.searchParams.set('skipHttpRedirect', 'true')
        const media = photoMediaSchema.parse(await this.requester.request({
          method: 'GET',
          url,
          headers: { 'x-goog-api-key': this.config.apiKey, accept: 'application/json' },
          timeoutMilliseconds: this.config.timeoutMilliseconds,
        }))
        mediaUri = safeHttpUrl(media.photoUri)
      } catch {
        mediaUri = undefined
      }
    }
    const externalUri = safeHttpUrl(payload.googleMapsUri)
    const location = payload.location === undefined ||
      payload.location.latitude < -90 || payload.location.latitude > 90 ||
      payload.location.longitude < -180 || payload.location.longitude > 180
      ? null
      : payload.location
    return {
      schemaVersion: 'place-provider-detail.v1',
      providerKey: 'google',
      providerPlaceId: payload.id,
      name,
      address: visibleText(payload.formattedAddress, 500) ?? null,
      location,
      categoryLabel: payload.primaryTypeDisplayName === undefined
        ? null
        : visibleText(payload.primaryTypeDisplayName.text, 300) ?? null,
      ...(externalUri === undefined ? {} : { externalUri }),
      ...(payload.nationalPhoneNumber === undefined
        ? {}
        : { phone: payload.nationalPhoneNumber.slice(0, 100) }),
      ...(payload.rating === undefined ? {} : { rating: payload.rating }),
      ...(payload.userRatingCount === undefined
        ? {}
        : { userRatingCount: payload.userRatingCount }),
      ...(payload.businessStatus === undefined
        ? {}
        : { businessStatus: payload.businessStatus.slice(0, 100) }),
      ...(payload.currentOpeningHours === undefined ? {} : {
        openingHours: {
          ...(payload.currentOpeningHours.openNow === undefined
            ? {}
            : { openNow: payload.currentOpeningHours.openNow }),
          weekdayDescriptions: payload.currentOpeningHours.weekdayDescriptions
            .flatMap((value) => visibleText(value, 300) ?? [])
            .slice(0, 14),
        },
      }),
      photos: firstPhoto === undefined ? [] : [{
        ...(mediaUri === undefined ? {} : { mediaUri }),
        ...(firstPhoto.widthPx === undefined ? {} : { width: firstPhoto.widthPx }),
        ...(firstPhoto.heightPx === undefined ? {} : { height: firstPhoto.heightPx }),
        authorAttributions: authorAttributions(firstPhoto.authorAttributions),
      }],
      attributions: [{
        label: 'Google Maps',
        ...(externalUri === undefined ? {} : { uri: externalUri }),
      }],
      observedAt: this.now().toISOString(),
    }
  }
}
