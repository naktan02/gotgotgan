import { createHash } from 'node:crypto'

import type {
  ProviderAttribution,
  ProviderKey,
  ProviderSearchPage,
  ProviderSearchQuery,
  ProviderSearchResult,
} from '../../domain/model.js'
import { ProviderRequestFailure } from './provider-http.js'

export function providerResultId(providerKey: ProviderKey, parts: readonly string[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([providerKey, ...parts]))
    .digest('base64url')
  return `${providerKey}:${digest}`
}

export function safeHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' && url.password === ''
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

export function visibleText(value: string, maximum: number): string | undefined {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return normalized.length === 0 ? undefined : normalized.slice(0, maximum)
}

export function unsupportedQuery(query: ProviderSearchQuery): ProviderSearchPage | undefined {
  if (query.query.trim() === '') return { status: 'complete', items: [] }
  if (
    query.filters.taxonomyKeys.length > 0 ||
    query.filters.saved !== undefined ||
    query.filters.wanted !== undefined ||
    query.filters.visited !== undefined ||
    query.filters.minimumPersonalRating !== undefined
  ) {
    return {
      status: 'partial', items: [], errorCode: 'PLACE_PROVIDER_FILTER_UNSUPPORTED',
    }
  }
  return undefined
}

export function withinBounds(
  result: Readonly<{ latitude: number; longitude: number }>,
  query: ProviderSearchQuery,
): boolean {
  const bounds = query.bounds
  return bounds === undefined || (
    result.longitude >= bounds.west && result.longitude <= bounds.east &&
    result.latitude >= bounds.south && result.latitude <= bounds.north
  )
}

export function unavailablePage(error: unknown): ProviderSearchPage {
  return {
    status: 'unavailable',
    items: [],
    errorCode: error instanceof ProviderRequestFailure
      ? error.code
      : 'PLACE_PROVIDER_UNAVAILABLE',
  }
}

export function providerResult(input: Readonly<{
  providerKey: ProviderKey
  providerLabel: string
  providerPlaceId?: string
  name: string
  areaLabel: string | null
  latitude: number
  longitude: number
  externalUri?: string
  categoryLabel?: string
  detailsAvailable: boolean
  observedAt: string
  extraAttributions?: readonly ProviderAttribution[]
}>): ProviderSearchResult {
  const identityParts = input.providerPlaceId === undefined
    ? [input.name, input.areaLabel ?? '', String(input.latitude), String(input.longitude)]
    : [input.providerPlaceId]
  return {
    resultId: providerResultId(input.providerKey, identityParts),
    identity: {
      kind: 'provider',
      providerKey: input.providerKey,
      ...(input.providerPlaceId === undefined ? {} : { providerPlaceId: input.providerPlaceId }),
    },
    source: {
      key: input.providerKey,
      label: input.providerLabel,
      ...(input.externalUri === undefined ? {} : { externalUri: input.externalUri }),
      ...(input.categoryLabel === undefined ? {} : { categoryLabel: input.categoryLabel }),
      detailsAvailable: input.detailsAvailable,
      attributions: [
        { label: input.providerLabel },
        ...(input.extraAttributions ?? []),
      ],
    },
    freshness: { kind: 'live', observedAt: input.observedAt },
    name: input.name,
    areaLabel: input.areaLabel,
    location: { latitude: input.latitude, longitude: input.longitude },
    primaryTaxonomy: null,
    taxonomyKeys: [],
    evidenceStatus: 'unverified',
  }
}
