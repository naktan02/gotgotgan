import { z } from 'zod'

import { uuidSchema } from '../primitives.js'
import { providerKeySchema } from '../providers/index.js'

export { providerKeySchema } from '../providers/index.js'

const httpUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' && url.password === ''
}, { message: 'Only HTTP(S) URLs are allowed.' })

export const searchBoundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
}).strict().refine((bounds) => bounds.west < bounds.east && bounds.south < bounds.north, {
  message: 'Search bounds must describe a non-empty viewport.',
})

export const placeSearchRequestSchema = z.object({
  schemaVersion: z.literal('place-search.v1'),
  query: z.string().trim().max(200),
  bounds: searchBoundsSchema.optional(),
  filters: z.object({
    taxonomyKeys: z.array(z.string().min(1).max(128)).max(16).default([]),
    saved: z.boolean().optional(),
    wanted: z.boolean().optional(),
    visited: z.boolean().optional(),
    minimumPersonalRating: z.number().min(0.1).max(5).multipleOf(0.1).optional(),
  }).strict().default({ taxonomyKeys: [] }),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict()

export const searchPersonalStateSchema = z.object({
  saved: z.boolean(),
  wanted: z.boolean(),
  visited: z.boolean(),
  personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable(),
}).strict()

export const searchResultIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('canonical'), placeId: uuidSchema }).strict(),
  z.object({
    kind: z.literal('provider'),
    providerKey: providerKeySchema,
    providerPlaceId: z.string().min(1).max(512).optional(),
  }).strict(),
])

export const providerAttributionSchema = z.object({
  label: z.string().min(1).max(200),
  uri: httpUrlSchema.optional(),
}).strict()

export const placeSearchResultSchema = z.object({
  resultId: z.string().min(1).max(256),
  identity: searchResultIdentitySchema,
  source: z.object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    externalUri: httpUrlSchema.optional(),
    categoryLabel: z.string().min(1).max(300).optional(),
    detailsAvailable: z.boolean(),
    attributions: z.array(providerAttributionSchema).max(10),
  }).strict(),
  freshness: z.object({
    kind: z.enum(['indexed', 'live']),
    observedAt: z.iso.datetime({ offset: true }),
  }).strict(),
  name: z.string().min(1).max(300),
  areaLabel: z.string().min(1).max(300).nullable(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict(),
  primaryTaxonomy: z.object({
    key: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  }).strict().nullable(),
  taxonomyKeys: z.array(z.string().min(1).max(128)).max(32),
  evidenceStatus: z.enum(['verified', 'unverified', 'conflicted', 'stale']),
  personalState: searchPersonalStateSchema.optional(),
}).strict()

export const searchSourceOutcomeSchema = z.object({
  sourceKey: z.string().min(1).max(64),
  status: z.enum(['complete', 'partial', 'unavailable']),
  resultCount: z.number().int().nonnegative(),
  errorCode: z.string().min(1).max(128).optional(),
}).strict()

const suggestionSessionIdSchema = uuidSchema
const suggestionIdSchema = uuidSchema

export const placeSuggestionsRequestSchema = z.object({
  schemaVersion: z.literal('place-suggestions.v1'),
  query: z.string().trim().min(1).max(200),
  sessionId: suggestionSessionIdSchema.optional(),
  bounds: searchBoundsSchema.optional(),
  areaText: z.string().trim().min(1).max(160).optional(),
  language: z.string().trim().min(2).max(35).optional(),
  limit: z.number().int().min(1).max(12).default(8),
}).strict()

export const placeSuggestionSchema = z.object({
  suggestionId: suggestionIdSchema,
  identity: searchResultIdentitySchema,
  source: z.object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    externalUri: httpUrlSchema.optional(),
    detailsAvailable: z.boolean(),
    attributions: z.array(providerAttributionSchema).max(10),
  }).strict(),
  name: z.string().min(1).max(300),
  areaLabel: z.string().min(1).max(300).nullable(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().nullable(),
  categoryLabel: z.string().min(1).max(300).nullable(),
  observedAt: z.iso.datetime({ offset: true }),
}).strict()

export const placeSuggestionsResponseSchema = z.object({
  schemaVersion: z.literal('place-suggestions.v1'),
  sessionId: suggestionSessionIdSchema,
  items: z.array(placeSuggestionSchema).max(12),
  sources: z.array(searchSourceOutcomeSchema).min(1).max(16),
}).strict()

export const placeSuggestionSelectionRequestSchema = z.object({
  schemaVersion: z.literal('place-suggestion-selection.v1'),
  suggestionId: suggestionIdSchema,
}).strict()

export const placeSuggestionSelectionResponseSchema = z.object({
  schemaVersion: z.literal('place-suggestion-selection.v1'),
  suggestionId: suggestionIdSchema,
  status: z.enum(['recorded', 'replayed', 'canonical']),
  observationId: uuidSchema.optional(),
}).strict()

export const placeSuggestionMaterializationRequestSchema = z.object({
  schemaVersion: z.literal('place-suggestion-materialization.v1'),
  suggestionId: suggestionIdSchema,
  intent: z.enum(['save', 'wanted', 'visit', 'rating', 'note', 'collection', 'share', 'place-reference']),
}).strict()

export const placeSuggestionMaterializationResponseSchema = z.object({
  schemaVersion: z.literal('place-suggestion-materialization.v1'),
  suggestionId: suggestionIdSchema,
  status: z.enum(['created', 'linked', 'replayed']),
  canonicalPlaceId: uuidSchema,
}).strict()

export const providerPlaceDetailRequestSchema = z.object({
  schemaVersion: z.literal('place-provider-detail.v1'),
  providerKey: providerKeySchema,
  providerPlaceId: z.string().min(1).max(512),
}).strict()

export const providerPlaceDetailSchema = z.object({
  schemaVersion: z.literal('place-provider-detail.v1'),
  providerKey: providerKeySchema,
  providerPlaceId: z.string().min(1).max(512),
  name: z.string().min(1).max(300),
  address: z.string().min(1).max(500).nullable(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().nullable(),
  categoryLabel: z.string().min(1).max(300).nullable(),
  externalUri: httpUrlSchema.optional(),
  phone: z.string().min(1).max(100).optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().nonnegative().optional(),
  businessStatus: z.string().min(1).max(100).optional(),
  openingHours: z.object({
    openNow: z.boolean().optional(),
    weekdayDescriptions: z.array(z.string().min(1).max(300)).max(14),
  }).strict().optional(),
  photos: z.array(z.object({
    mediaUri: httpUrlSchema.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    authorAttributions: z.array(providerAttributionSchema).max(10),
  }).strict()).max(3),
  attributions: z.array(providerAttributionSchema).min(1).max(10),
  observedAt: z.iso.datetime({ offset: true }),
}).strict()

export const taxonomyNodeSchema = z.object({
  key: z.string().min(1).max(128),
  parentKey: z.string().min(1).max(128).nullable(),
  label: z.string().min(1).max(160),
  kind: z.enum(['category', 'attribute']),
  version: z.number().int().positive(),
}).strict()

export const taxonomyProjectionSchema = z.object({
  schemaVersion: z.literal('place-taxonomy.v1'),
  nodes: z.array(taxonomyNodeSchema).max(2_000),
}).strict()

export const placeSearchResponseSchema = z.object({
  schemaVersion: z.literal('place-search.v1'),
  items: z.array(placeSearchResultSchema).max(50),
  nextCursor: z.string().min(1).max(2_048).optional(),
  sources: z.array(searchSourceOutcomeSchema).min(1).max(16),
}).strict()

const catalogSearchTokenIdSchema = z.string().min(1).max(512)
const catalogVersionedReferenceSchema = z.object({
  key: z.string().min(1).max(128),
  version: z.number().int().positive(),
}).strict()

export const catalogSearchInterpretationTokenSchema = z.discriminatedUnion('kind', [
  catalogVersionedReferenceSchema.extend({
    tokenId: catalogSearchTokenIdSchema,
    kind: z.literal('area'),
    label: z.string().min(1).max(160),
  }).strict(),
  catalogVersionedReferenceSchema.extend({
    tokenId: catalogSearchTokenIdSchema,
    kind: z.literal('place-type'),
    label: z.string().min(1).max(160),
  }).strict(),
  catalogVersionedReferenceSchema.extend({
    tokenId: catalogSearchTokenIdSchema,
    kind: z.literal('attribute'),
    label: z.string().min(1).max(160),
  }).strict(),
  z.object({
    tokenId: catalogSearchTokenIdSchema,
    kind: z.literal('query'),
    label: z.string().min(1).max(200),
    normalizedQuery: z.string().min(1).max(200),
  }).strict(),
])

export const catalogPlaceSearchRequestSchema = z.object({
  schemaVersion: z.literal('catalog-place-search.v1'),
  query: z.string().trim().max(200),
  excludedTokenIds: z.array(catalogSearchTokenIdSchema).max(32).default([])
    .refine((values) => new Set(values).size === values.length, {
      message: 'Excluded interpretation tokens must be unique.',
    }),
  bounds: searchBoundsSchema.optional(),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict()

export const catalogPlaceSummarySchema = z.object({
  placeId: uuidSchema,
  name: z.string().min(1).max(300),
  area: z.object({
    label: z.string().min(1).max(300),
    reference: catalogVersionedReferenceSchema.nullable(),
  }).strict().nullable(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().nullable(),
  primaryTaxonomy: z.object({
    key: z.string().min(1).max(128),
    version: z.number().int().positive().nullable(),
    label: z.string().min(1).max(160),
  }).strict().nullable(),
  taxonomyReferences: z.array(catalogVersionedReferenceSchema.extend({
    kind: z.enum(['category', 'attribute']),
  }).strict()).max(32),
  evidenceStatus: z.enum(['verified', 'unverified', 'conflicted', 'stale']),
  projectedAt: z.iso.datetime({ offset: true }),
}).strict()

export const catalogPlaceSearchResponseSchema = z.object({
  schemaVersion: z.literal('catalog-place-search.v1'),
  interpretation: z.object({
    normalizedQuery: z.string().max(200),
    tokens: z.array(catalogSearchInterpretationTokenSchema).max(32),
  }).strict(),
  items: z.array(catalogPlaceSummarySchema).max(50),
  mapBounds: searchBoundsSchema.nullable(),
  nextCursor: z.string().min(1).max(2_048).optional(),
}).strict()

export type ProviderKey = z.infer<typeof providerKeySchema>
export type SearchBounds = z.infer<typeof searchBoundsSchema>
export type PlaceSearchRequestInput = z.input<typeof placeSearchRequestSchema>
export type PlaceSearchRequest = z.infer<typeof placeSearchRequestSchema>
export type SearchPersonalState = z.infer<typeof searchPersonalStateSchema>
export type SearchResultIdentity = z.infer<typeof searchResultIdentitySchema>
export type ProviderAttribution = z.infer<typeof providerAttributionSchema>
export type PlaceSearchResult = z.infer<typeof placeSearchResultSchema>
export type SearchSourceOutcome = z.infer<typeof searchSourceOutcomeSchema>
export type PlaceSuggestionsRequestInput = z.input<typeof placeSuggestionsRequestSchema>
export type PlaceSuggestionsRequest = z.infer<typeof placeSuggestionsRequestSchema>
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>
export type PlaceSuggestionsResponse = z.infer<typeof placeSuggestionsResponseSchema>
export type PlaceSuggestionSelectionRequest = z.infer<typeof placeSuggestionSelectionRequestSchema>
export type PlaceSuggestionSelectionResponse = z.infer<typeof placeSuggestionSelectionResponseSchema>
export type PlaceSuggestionMaterializationRequest = z.infer<typeof placeSuggestionMaterializationRequestSchema>
export type PlaceSuggestionMaterializationResponse = z.infer<typeof placeSuggestionMaterializationResponseSchema>
export type PlaceSearchResponse = z.infer<typeof placeSearchResponseSchema>
export type CatalogSearchInterpretationToken = z.infer<typeof catalogSearchInterpretationTokenSchema>
export type CatalogPlaceSearchRequestInput = z.input<typeof catalogPlaceSearchRequestSchema>
export type CatalogPlaceSearchRequest = z.infer<typeof catalogPlaceSearchRequestSchema>
export type CatalogPlaceSummary = z.infer<typeof catalogPlaceSummarySchema>
export type CatalogPlaceSearchResponse = z.infer<typeof catalogPlaceSearchResponseSchema>
export type ProviderPlaceDetailRequest = z.infer<typeof providerPlaceDetailRequestSchema>
export type ProviderPlaceDetail = z.infer<typeof providerPlaceDetailSchema>
export type TaxonomyNode = z.infer<typeof taxonomyNodeSchema>
export type TaxonomyProjection = z.infer<typeof taxonomyProjectionSchema>
