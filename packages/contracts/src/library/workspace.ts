import { z } from 'zod'

import { placeSummarySchema } from '../places/index.js'
import { isNonEmptyMapViewport, mapQueryViewportFields, mapQueryZoomSchema, uuidSchema } from '../primitives.js'
import { libraryMapResponseSchema } from './map.js'
import {
  libraryAreaFacetKeySchema as areaFacetKeySchema,
  libraryAreaKeysSchema as areaKeysSchema,
  libraryCollectionRevisionV2Schema,
  libraryCursorSchema as cursorSchema,
  libraryPageLimitSchema as pageLimitSchema,
  libraryTagIdsSchema as tagIdsSchema,
  libraryTagMatchSchema,
  libraryTaxonomyFacetKeySchema as taxonomyFacetKeySchema,
  libraryTaxonomyKeysSchema as taxonomyKeysSchema,
  libraryPlaceFacetSchema,
  librarySearchTextSchema,
} from './contract-primitives.js'

/**
 * Collection-first Personal Library contracts.
 *
 * These v2 schemas intentionally do not reuse the legacy saved/wanted state model. A Place is a
 * favorite when it belongs to at least one member-owned Collection; Personal Rating remains an
 * independent annotation and filter.
 */
export const personalLibraryFavoriteScopeV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({
    kind: z.literal('collection'),
    collectionId: uuidSchema,
  }).strict(),
])

export const personalLibraryRatingFilterV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('any') }).strict(),
  z.object({ kind: z.literal('rated') }).strict(),
  z.object({ kind: z.literal('unrated') }).strict(),
])

export const personalLibraryOverlayV2Schema = z.object({
  isFavorited: z.boolean(),
  collectionCount: z.number().int().nonnegative(),
  personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable(),
}).strict().refine(
  (overlay) => overlay.isFavorited === (overlay.collectionCount > 0),
  'isFavorited must reflect whether the Place belongs to at least one Collection',
)

export const personalLibraryCollectionSummaryV2Schema = z.object({
  collectionId: uuidSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  visibility: z.enum(['private', 'unlisted', 'public']),
  publicationId: uuidSchema.nullable(),
  placeCount: z.number().int().nonnegative(),
  collectionRevision: libraryCollectionRevisionV2Schema,
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const personalLibraryWorkspaceRequestV2Schema = z.object({
  includeSelectedCollection: z.literal(true).optional(),
  collectionQuery: librarySearchTextSchema.optional(),
  placeQuery: librarySearchTextSchema.optional(),
  favoriteScope: personalLibraryFavoriteScopeV2Schema.default({ kind: 'all' }),
  ratingFilter: personalLibraryRatingFilterV2Schema.default({ kind: 'any' }),
  tagIds: tagIdsSchema,
  tagMatch: libraryTagMatchSchema.default('all'),
  areaKeys: areaKeysSchema,
  taxonomyKeys: taxonomyKeysSchema,
  collectionCursor: cursorSchema.optional(),
  placeCursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

/** Flat transport query projected into `personalLibraryWorkspaceRequestV2Schema` by the API. */
export const personalLibraryWorkspaceHttpQueryV2Schema = z.object({
  includeSelectedCollection: z.preprocess((value) => value === 'true' ? true : value, z.literal(true).optional()),
  collectionQuery: librarySearchTextSchema.optional(),
  placeQuery: librarySearchTextSchema.optional(),
  collectionId: uuidSchema.optional(),
  rating: z.enum(['any', 'rated', 'unrated']).default('any'),
  tagIds: tagIdsSchema,
  tagMatch: libraryTagMatchSchema.default('all'),
  areaKeys: areaKeysSchema,
  taxonomyKeys: taxonomyKeysSchema,
  collectionCursor: cursorSchema.optional(),
  placeCursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const personalLibraryWorkspaceResponseV2Schema = z.object({
  schemaVersion: z.literal('personal-library-workspace.v2'),
  selectedCollection: personalLibraryCollectionSummaryV2Schema.optional(),
  filter: z.object({
    favoriteScope: personalLibraryFavoriteScopeV2Schema,
    collectionQuery: z.string().max(160).optional(),
    placeQuery: z.string().max(160).optional(),
    ratingFilter: personalLibraryRatingFilterV2Schema,
    tagIds: z.array(uuidSchema).max(20),
    tagMatch: libraryTagMatchSchema,
    areaKeys: z.array(areaFacetKeySchema).max(10),
    taxonomyKeys: z.array(taxonomyFacetKeySchema).max(10),
  }).strict(),
  collections: z.array(personalLibraryCollectionSummaryV2Schema).max(50),
  collectionNextCursor: cursorSchema.optional(),
  places: z.array(z.object({
    placeId: uuidSchema,
    overlay: personalLibraryOverlayV2Schema,
    place: placeSummarySchema.nullable(),
  }).strict()).max(50),
  placeNextCursor: cursorSchema.optional(),
  availableFilters: z.object({
    coverage: z.object({
      favoritePlaceCount: z.number().int().nonnegative(),
      sampledPlaceCount: z.number().int().nonnegative(),
      projectedPlaceCount: z.number().int().nonnegative(),
      complete: z.boolean(),
    }).strict(),
    areas: z.array(libraryPlaceFacetSchema.extend({ key: areaFacetKeySchema })).max(50),
    taxonomies: z.array(libraryPlaceFacetSchema.extend({
      key: taxonomyFacetKeySchema,
    })).max(50),
  }).strict(),
}).strict()

export const personalLibraryMapRequestV2Schema = personalLibraryWorkspaceRequestV2Schema.omit({
  includeSelectedCollection: true,
  collectionQuery: true, collectionCursor: true, placeCursor: true, limit: true,
}).extend({ ...mapQueryViewportFields, zoom: mapQueryZoomSchema })
  .refine(isNonEmptyMapViewport, 'map viewport must be non-empty')

export const personalLibraryMapHttpQueryV2Schema = personalLibraryWorkspaceHttpQueryV2Schema.omit({
  includeSelectedCollection: true,
  collectionQuery: true, collectionCursor: true, placeCursor: true, limit: true,
}).extend({ ...mapQueryViewportFields, zoom: mapQueryZoomSchema })
  .refine(isNonEmptyMapViewport, 'map viewport must be non-empty')

export const personalLibraryMapResponseV2Schema = z.object({
  schemaVersion: z.literal('personal-library-map.v2'),
  filter: personalLibraryWorkspaceResponseV2Schema.shape.filter.omit({ collectionQuery: true }),
  viewport: libraryMapResponseSchema.shape.viewport,
  features: libraryMapResponseSchema.shape.features,
  coverage: libraryMapResponseSchema.shape.coverage,
}).strict().superRefine((projection, context) => {
  const represented = projection.features.reduce((count, feature) => (
    count + (feature.kind === 'place' ? 1 : feature.count)
  ), 0)
  if (represented !== projection.coverage.representedPlaceCount ||
      projection.coverage.complete !== (projection.coverage.unprojectedPlaceCount === 0)) {
    context.addIssue({ code: 'custom', message: 'map coverage must match represented and unprojected places' })
  }
})

export type PersonalLibraryMapRequestV2 = z.infer<typeof personalLibraryMapRequestV2Schema>
export type PersonalLibraryFavoriteScopeV2 = z.infer<typeof personalLibraryFavoriteScopeV2Schema>
export type PersonalLibraryRatingFilterV2 = z.infer<typeof personalLibraryRatingFilterV2Schema>
export type PersonalLibraryMapResponseV2 = z.infer<typeof personalLibraryMapResponseV2Schema>

export type PersonalLibraryWorkspaceRequestV2 = z.infer<typeof personalLibraryWorkspaceRequestV2Schema>
export type PersonalLibraryWorkspaceHttpQueryV2 = z.infer<typeof personalLibraryWorkspaceHttpQueryV2Schema>
export type PersonalLibraryWorkspaceResponseV2 = z.infer<typeof personalLibraryWorkspaceResponseV2Schema>
