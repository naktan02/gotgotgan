import { z } from 'zod'

import { placeSummarySchema } from '../places/index.js'
import { uuidSchema } from '../primitives.js'

const cursorSchema = z.string().min(1).max(2_048)
const pageLimitSchema = z.coerce.number().int().min(1).max(50).default(20)
const tagIdsSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(uuidSchema).max(20).refine(
    (tagIds) => new Set(tagIds).size === tagIds.length,
    'tagIds must be unique',
  ).transform((tagIds) => [...tagIds].sort()),
)
const areaFacetKeySchema = z.string().regex(/^area_[A-Za-z0-9_-]{22}$/)
const taxonomyFacetKeySchema = z.string().min(1).max(128)
const areaKeysSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(areaFacetKeySchema).max(10).refine(
    (keys) => new Set(keys).size === keys.length,
    'areaKeys must be unique',
  ).transform((keys) => [...keys].sort()),
)
const taxonomyKeysSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(taxonomyFacetKeySchema).max(10).refine(
    (keys) => new Set(keys).size === keys.length,
    'taxonomyKeys must be unique',
  ).transform((keys) => [...keys].sort()),
)

const longitudeSchema = z.coerce.number().finite().min(-180).max(180)
const latitudeSchema = z.coerce.number().finite().min(-90).max(90)
const libraryMapViewportFields = {
  west: longitudeSchema,
  south: latitudeSchema,
  east: longitudeSchema,
  north: latitudeSchema,
  zoom: z.coerce.number().int().min(0).max(22),
}

const validMapBounds = (bounds: Readonly<{
  west: number
  south: number
  east: number
  north: number
}>) => bounds.west < bounds.east && bounds.south < bounds.north

export const libraryPlaceStateSchema = z.enum(['saved', 'wanted', 'rated'])
export const libraryTagMatchSchema = z.enum(['all', 'any'])

export const libraryPlaceListQuerySchema = z.object({
  state: libraryPlaceStateSchema.default('saved'),
  tagIds: tagIdsSchema,
  tagMatch: libraryTagMatchSchema.default('all'),
  areaKeys: areaKeysSchema,
  taxonomyKeys: taxonomyKeysSchema,
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const libraryCollectionListQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const libraryCollectionDetailQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const libraryTagListQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const libraryPlaceOrganizationQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const libraryPlaceFacetsQuerySchema = z.object({}).strict()

export const libraryMapQuerySchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('state'),
    state: libraryPlaceStateSchema.default('saved'),
    tagIds: tagIdsSchema,
    tagMatch: libraryTagMatchSchema.default('all'),
    areaKeys: areaKeysSchema,
    taxonomyKeys: taxonomyKeysSchema,
    ...libraryMapViewportFields,
  }).strict(),
  z.object({
    scope: z.literal('collection'),
    collectionId: uuidSchema,
    ...libraryMapViewportFields,
  }).strict(),
]).refine(validMapBounds, 'map bounds must have positive width and height')

export const libraryCollectionIdentifierParamsSchema = z.object({
  collectionId: uuidSchema,
}).strict()

export const libraryPlaceIdentifierParamsSchema = z.object({
  placeId: uuidSchema,
}).strict()

const preferenceFields = {
  saved: z.boolean(),
  wanted: z.boolean(),
  personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}

export const libraryPlacePreferencesResponseSchema = z.object({
  schemaVersion: z.literal('library-place-preferences.v1'),
  placeId: uuidSchema,
  ...preferenceFields,
}).strict()

export const libraryCommandResultSchema = z.object({
  schemaVersion: z.literal('library-command-result.v1'),
  status: z.enum(['applied', 'replayed']),
}).strict()

export const libraryPlaceListResponseSchema = z.object({
  schemaVersion: z.literal('library-place-list.v3'),
  filter: z.object({
    state: libraryPlaceStateSchema,
    tagIds: z.array(uuidSchema).max(20),
    tagMatch: libraryTagMatchSchema,
    areaKeys: z.array(areaFacetKeySchema).max(10),
    taxonomyKeys: z.array(taxonomyFacetKeySchema).max(10),
  }).strict(),
  items: z.array(z.object({
    placeId: uuidSchema,
    ...preferenceFields,
    place: placeSummarySchema.nullable(),
  }).strict()).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

const libraryPlaceFacetSchema = z.object({
  key: z.string().min(1).max(128),
  label: z.string().min(1).max(300),
  count: z.number().int().positive(),
}).strict()

export const libraryPlaceFacetsResponseSchema = z.object({
  schemaVersion: z.literal('library-place-facets.v1'),
  sourceState: z.literal('saved'),
  coverage: z.object({
    savedPlaceCount: z.number().int().nonnegative(),
    sampledPlaceCount: z.number().int().nonnegative(),
    projectedPlaceCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }).strict().refine(
    (coverage) => coverage.projectedPlaceCount <= coverage.sampledPlaceCount &&
      coverage.sampledPlaceCount <= coverage.savedPlaceCount,
    'facet coverage counts must be monotonic',
  ),
  areas: z.array(libraryPlaceFacetSchema.extend({ key: areaFacetKeySchema })).max(50),
  taxonomies: z.array(libraryPlaceFacetSchema.extend({
    key: taxonomyFacetKeySchema,
    label: z.string().min(1).max(160),
  })).max(50),
}).strict()

const libraryMapBoundsSchema = z.object({
  west: longitudeSchema,
  south: latitudeSchema,
  east: longitudeSchema,
  north: latitudeSchema,
}).strict().refine(validMapBounds, 'map bounds must have positive width and height')

const libraryMapScopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('state'),
    state: libraryPlaceStateSchema,
    tagIds: z.array(uuidSchema).max(20),
    tagMatch: libraryTagMatchSchema,
    areaKeys: z.array(areaFacetKeySchema).max(10),
    taxonomyKeys: z.array(taxonomyFacetKeySchema).max(10),
  }).strict(),
  z.object({
    kind: z.literal('collection'),
    collectionId: uuidSchema,
  }).strict(),
])

const libraryMapFeatureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('place'),
    placeId: uuidSchema,
    label: z.string().min(1).max(300),
    location: z.object({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal('cluster'),
    clusterId: z.string().min(1).max(160),
    count: z.number().int().min(2),
    location: z.object({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
    }).strict(),
    bounds: libraryMapBoundsSchema,
  }).strict(),
])

export const libraryMapResponseSchema = z.object({
  schemaVersion: z.literal('library-map-projection.v1'),
  scope: libraryMapScopeSchema,
  viewport: z.object({
    bounds: libraryMapBoundsSchema,
    zoom: z.number().int().min(0).max(22),
  }).strict(),
  features: z.array(libraryMapFeatureSchema).max(500),
  coverage: z.object({
    representedPlaceCount: z.number().int().nonnegative(),
    unprojectedPlaceCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }).strict(),
}).strict().superRefine((projection, context) => {
  const represented = projection.features.reduce((count, feature) => (
    count + (feature.kind === 'place' ? 1 : feature.count)
  ), 0)
  if (represented !== projection.coverage.representedPlaceCount) {
    context.addIssue({
      code: 'custom',
      path: ['coverage', 'representedPlaceCount'],
      message: 'representedPlaceCount must equal the places represented by all features',
    })
  }
  if (projection.coverage.complete !== (projection.coverage.unprojectedPlaceCount === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['coverage', 'complete'],
      message: 'complete must reflect whether the active scope has unprojected places',
    })
  }
})

const collectionSummarySchema = z.object({
  collectionId: uuidSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  visibility: z.enum(['private', 'unlisted', 'public']),
  publicationId: uuidSchema.nullable(),
  placeCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

export const libraryCollectionListResponseSchema = z.object({
  schemaVersion: z.literal('library-collection-list.v1'),
  items: z.array(collectionSummarySchema).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const libraryCollectionDetailResponseSchema = z.object({
  schemaVersion: z.literal('library-collection-detail.v1'),
  collection: collectionSummarySchema,
  places: z.array(z.object({
    placeId: uuidSchema,
    position: z.number().int().nonnegative(),
    addedAt: z.iso.datetime({ offset: true }),
    place: placeSummarySchema.nullable(),
  }).strict()).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const libraryTagListResponseSchema = z.object({
  schemaVersion: z.literal('library-tag-list.v1'),
  items: z.array(z.object({
    tagId: uuidSchema,
    name: z.string().min(1).max(64),
    placeCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
  }).strict()).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const libraryPlaceOrganizationResponseSchema = z.object({
  schemaVersion: z.literal('library-place-organization.v1'),
  placeId: uuidSchema,
  items: z.array(z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('collection'),
      collectionId: uuidSchema,
      name: z.string().min(1).max(120),
      selected: z.boolean(),
      position: z.number().int().nonnegative().nullable(),
    }).strict().refine(
      (item) => item.selected === (item.position !== null),
      'selected Collection choices must have a position',
    ),
    z.object({
      kind: z.literal('tag'),
      tagId: uuidSchema,
      name: z.string().min(1).max(64),
      selected: z.boolean(),
    }).strict(),
  ])).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

/**
 * Collection-first Personal Library contracts.
 *
 * These v2 schemas intentionally do not reuse the legacy saved/wanted state model. A Place is a
 * favorite when it belongs to at least one member-owned Collection; Personal Rating remains an
 * independent annotation and filter.
 */
export const libraryCollectionRevisionV2Schema = z.string().min(1).max(2_048)

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

export const personalLibraryWorkspaceResponseV2Schema = z.object({
  schemaVersion: z.literal('personal-library-workspace.v2'),
  filter: z.object({
    favoriteScope: personalLibraryFavoriteScopeV2Schema,
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
}).strict()

export const placeFilingRequestV2Schema = z.object({
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema,
}).strict()

export const placeFilingResponseV2Schema = z.object({
  schemaVersion: z.literal('place-filing.v2'),
  placeId: uuidSchema,
  overlay: personalLibraryOverlayV2Schema,
  collections: z.array(z.object({
    collectionId: uuidSchema,
    name: z.string().min(1).max(120),
    included: z.boolean(),
    collectionRevision: libraryCollectionRevisionV2Schema,
  }).strict()).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

/**
 * Receipt for one idempotent Library operation. `commandId` retains the existing HTTP command
 * convention while identifying the operation whose result was applied or replayed.
 */
export const libraryOperationReceiptV2Schema = z.object({
  commandId: uuidSchema,
  status: z.enum(['applied', 'replayed']),
}).strict()

export const libraryOperationRejectionV2Schema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('not-found'),
  }).strict(),
  z.object({
    code: z.literal('version-conflict'),
  }).strict(),
  z.object({
    code: z.literal('operation-id-reused'),
  }).strict(),
  z.object({
    code: z.literal('invalid-selection'),
  }).strict(),
  z.object({
    code: z.literal('anchor-not-found'),
  }).strict(),
  z.object({
    code: z.literal('source-membership-missing'),
  }).strict(),
  z.object({
    code: z.literal('collection-limit-exceeded'),
    limit: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    code: z.literal('binding-version-conflict'),
  }).strict(),
  z.object({
    code: z.literal('publication-changed'),
  }).strict(),
])

export const placeFilingDesiredStateV2Schema = z.enum(['included', 'excluded'])

const placeFilingChangeV2Schema = z.object({
  collectionId: uuidSchema,
  expectedCollectionRevision: libraryCollectionRevisionV2Schema,
  desired: placeFilingDesiredStateV2Schema,
}).strict()

export const placeFilingCommandRequestV2Schema = z.object({
  schemaVersion: z.literal('place-filing-command.v2'),
  commandId: uuidSchema,
  placeId: uuidSchema,
  changes: z.array(placeFilingChangeV2Schema).min(1).max(50),
}).strict().refine(
  (request) => new Set(request.changes.map((change) => change.collectionId)).size === request.changes.length,
  'each Collection may appear only once in an atomic filing command',
)

const placeFilingAppliedCollectionV2Schema = z.object({
  collectionId: uuidSchema,
  included: z.boolean(),
  collectionRevision: libraryCollectionRevisionV2Schema,
}).strict()

export const placeFilingCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('place-filing-command-result.v2'),
    outcome: z.literal('accepted'),
    receipt: libraryOperationReceiptV2Schema,
    placeId: uuidSchema,
    overlay: personalLibraryOverlayV2Schema,
    collections: z.array(placeFilingAppliedCollectionV2Schema).min(1).max(50),
  }).strict().refine(
    (result) => new Set(result.collections.map((collection) => collection.collectionId)).size ===
      result.collections.length,
    'each Collection result must appear only once',
  ),
  z.object({
    schemaVersion: z.literal('place-filing-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: libraryOperationRejectionV2Schema,
  }).strict(),
])

export const collectionOrderAnchorV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first') }).strict(),
  z.object({ kind: z.literal('last') }).strict(),
  z.object({
    kind: z.literal('before'),
    placeId: uuidSchema,
  }).strict(),
  z.object({
    kind: z.literal('after'),
    placeId: uuidSchema,
  }).strict(),
])

export const collectionOrderCommandRequestV2Schema = z.object({
  schemaVersion: z.literal('collection-order-command.v2'),
  commandId: uuidSchema,
  collectionId: uuidSchema,
  placeId: uuidSchema,
  expectedCollectionRevision: libraryCollectionRevisionV2Schema,
  anchor: collectionOrderAnchorV2Schema,
}).strict().refine(
  (command) => !('placeId' in command.anchor) || command.anchor.placeId !== command.placeId,
  'a Collection Place cannot be ordered relative to itself',
)

export const collectionOrderCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('collection-order-command-result.v2'),
    outcome: z.literal('accepted'),
    receipt: libraryOperationReceiptV2Schema,
    collectionId: uuidSchema,
    placeId: uuidSchema,
    collectionRevision: libraryCollectionRevisionV2Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('collection-order-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: libraryOperationRejectionV2Schema,
  }).strict(),
])

export type LibraryPlaceState = z.infer<typeof libraryPlaceStateSchema>
export type LibraryTagMatch = z.infer<typeof libraryTagMatchSchema>
export type LibraryPlacePreferencesResponse = z.infer<typeof libraryPlacePreferencesResponseSchema>
export type LibraryCommandResult = z.infer<typeof libraryCommandResultSchema>
export type LibraryPlaceListQuery = z.infer<typeof libraryPlaceListQuerySchema>
export type LibraryPlaceListResponse = z.infer<typeof libraryPlaceListResponseSchema>
export type LibraryPlaceFacetsResponse = z.infer<typeof libraryPlaceFacetsResponseSchema>
export type LibraryPlaceFacetsQuery = z.infer<typeof libraryPlaceFacetsQuerySchema>
export type LibraryMapQuery = z.infer<typeof libraryMapQuerySchema>
export type LibraryMapResponse = z.infer<typeof libraryMapResponseSchema>
export type LibraryCollectionListQuery = z.infer<typeof libraryCollectionListQuerySchema>
export type LibraryCollectionListResponse = z.infer<typeof libraryCollectionListResponseSchema>
export type LibraryCollectionDetailQuery = z.infer<typeof libraryCollectionDetailQuerySchema>
export type LibraryCollectionDetailResponse = z.infer<typeof libraryCollectionDetailResponseSchema>
export type LibraryTagListQuery = z.infer<typeof libraryTagListQuerySchema>
export type LibraryTagListResponse = z.infer<typeof libraryTagListResponseSchema>
export type LibraryPlaceOrganizationQuery = z.infer<typeof libraryPlaceOrganizationQuerySchema>
export type LibraryPlaceOrganizationResponse = z.infer<typeof libraryPlaceOrganizationResponseSchema>
export type LibraryCollectionRevisionV2 = z.infer<typeof libraryCollectionRevisionV2Schema>
export type PersonalLibraryFavoriteScopeV2 = z.infer<typeof personalLibraryFavoriteScopeV2Schema>
export type PersonalLibraryRatingFilterV2 = z.infer<typeof personalLibraryRatingFilterV2Schema>
export type PersonalLibraryOverlayV2 = z.infer<typeof personalLibraryOverlayV2Schema>
export type PersonalLibraryCollectionSummaryV2 = z.infer<typeof personalLibraryCollectionSummaryV2Schema>
export type PersonalLibraryWorkspaceRequestV2 = z.infer<typeof personalLibraryWorkspaceRequestV2Schema>
export type PersonalLibraryWorkspaceResponseV2 = z.infer<typeof personalLibraryWorkspaceResponseV2Schema>
export type PlaceFilingRequestV2 = z.infer<typeof placeFilingRequestV2Schema>
export type PlaceFilingResponseV2 = z.infer<typeof placeFilingResponseV2Schema>
export type LibraryOperationReceiptV2 = z.infer<typeof libraryOperationReceiptV2Schema>
export type LibraryOperationRejectionV2 = z.infer<typeof libraryOperationRejectionV2Schema>
export type PlaceFilingDesiredStateV2 = z.infer<typeof placeFilingDesiredStateV2Schema>
export type PlaceFilingCommandRequestV2 = z.infer<typeof placeFilingCommandRequestV2Schema>
export type PlaceFilingCommandResultV2 = z.infer<typeof placeFilingCommandResultV2Schema>
export type CollectionOrderAnchorV2 = z.infer<typeof collectionOrderAnchorV2Schema>
export type CollectionOrderCommandRequestV2 = z.infer<typeof collectionOrderCommandRequestV2Schema>
export type CollectionOrderCommandResultV2 = z.infer<typeof collectionOrderCommandResultV2Schema>
