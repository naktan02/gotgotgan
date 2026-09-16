import { z } from 'zod'

import { mapPlaceClassificationV3Schema } from '../maps/index.js'
import {
  isNonEmptyMapViewport,
  mapLocationSchema,
  mapQueryViewportFields,
  mapQueryZoomSchema,
  mapViewportSchema,
  uuidSchema,
} from '../primitives.js'
import {
  libraryAreaKeysSchema,
  libraryCollectionRevisionV2Schema,
  libraryOperationReceiptV2Schema,
  libraryOperationRejectionV2Schema,
  librarySearchTextSchema,
  libraryTagIdsSchema,
  libraryTagMatchSchema,
  libraryTaxonomyKeysSchema,
} from './contract-primitives.js'
import { personalLibraryRatingFilterV2Schema } from './workspace.js'

export const collectionColorTokens = [
  'fern', 'ocean', 'amber', 'coral', 'violet', 'cyan', 'magenta', 'slate',
] as const

export const collectionColorTokenSchema = z.enum(collectionColorTokens)

export const collectionColorCommandRequestV1Schema = z.object({
  schemaVersion: z.literal('collection-color-command.v1'),
  commandId: uuidSchema,
  collectionId: uuidSchema,
  expectedCollectionRevision: libraryCollectionRevisionV2Schema,
  colorToken: collectionColorTokenSchema,
}).strict()

export const collectionColorCommandResultV1Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('collection-color-command-result.v1'),
    outcome: z.literal('accepted'),
    receipt: libraryOperationReceiptV2Schema,
    collectionId: uuidSchema,
    collectionRevision: libraryCollectionRevisionV2Schema,
    colorToken: collectionColorTokenSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal('collection-color-command-result.v1'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: libraryOperationRejectionV2Schema,
  }).strict(),
])
export const personalLibraryMapMaximumSelectedCollectionsV4 = 100
export const personalLibraryMapMaximumClusterSegmentsV4 = 8

const collectionIdsSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(uuidSchema).max(personalLibraryMapMaximumSelectedCollectionsV4).refine(
    (ids) => new Set(ids).size === ids.length,
    'Collection selection must not contain duplicate IDs',
  ),
)

export const personalLibraryMapSelectionV4Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({
    kind: z.literal('collections'),
    collectionIds: z.array(uuidSchema).min(1).max(personalLibraryMapMaximumSelectedCollectionsV4).refine(
      (ids) => new Set(ids).size === ids.length,
      'Collection selection must not contain duplicate IDs',
    ),
  }).strict(),
])

export const personalLibraryMapRequestV4Schema = z.object({
  selection: personalLibraryMapSelectionV4Schema,
  placeQuery: librarySearchTextSchema.optional(),
  ratingFilter: personalLibraryRatingFilterV2Schema.default({ kind: 'any' }),
  tagIds: libraryTagIdsSchema,
  tagMatch: libraryTagMatchSchema.default('all'),
  areaKeys: libraryAreaKeysSchema,
  taxonomyKeys: libraryTaxonomyKeysSchema,
  selectedPlaceId: uuidSchema.optional(),
  ...mapQueryViewportFields,
  zoom: mapQueryZoomSchema,
}).strict().refine(isNonEmptyMapViewport, 'map viewport must be non-empty')

export const personalLibraryMapHttpQueryV4Schema = z.object({
  scope: z.enum(['all', 'collections']).default('all'),
  collectionIds: collectionIdsSchema,
  placeQuery: librarySearchTextSchema.optional(),
  rating: z.enum(['any', 'rated', 'unrated']).default('any'),
  tagIds: libraryTagIdsSchema,
  tagMatch: libraryTagMatchSchema.default('all'),
  areaKeys: libraryAreaKeysSchema,
  taxonomyKeys: libraryTaxonomyKeysSchema,
  selectedPlaceId: uuidSchema.optional(),
  ...mapQueryViewportFields,
  zoom: mapQueryZoomSchema,
}).strict().superRefine((query, context) => {
  if (query.scope === 'collections' && query.collectionIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['collectionIds'], message: 'Explicit Collection scope requires at least one ID' })
  }
  if (query.scope === 'all' && query.collectionIds.length !== 0) {
    context.addIssue({ code: 'custom', path: ['collectionIds'], message: 'All-favorites scope cannot include Collection IDs' })
  }
  if (!isNonEmptyMapViewport(query)) {
    context.addIssue({ code: 'custom', message: 'map viewport must be non-empty' })
  }
})

export const personalLibraryMapCollectionV4Schema = z.object({
  collectionId: uuidSchema,
  name: z.string().min(1).max(120),
  colorToken: collectionColorTokenSchema,
}).strict()

export const personalLibraryMapPlaceFeatureV4Schema = z.object({
  kind: z.literal('place'),
  placeId: uuidSchema,
  label: z.string().min(1).max(300),
  location: mapLocationSchema,
  classification: mapPlaceClassificationV3Schema,
  memberships: z.array(personalLibraryMapCollectionV4Schema)
    .min(1).max(personalLibraryMapMaximumSelectedCollectionsV4)
    .refine((items) => new Set(items.map((item) => item.collectionId)).size === items.length,
      'Place memberships must contain unique Collections'),
}).strict()

export const personalLibraryMapClusterFeatureV4Schema = z.object({
  kind: z.literal('cluster'),
  clusterId: z.string().min(1).max(160),
  count: z.number().int().min(2),
  location: mapLocationSchema,
  bounds: mapViewportSchema,
  coincidentPreview: z.object({
    places: z.array(personalLibraryMapPlaceFeatureV4Schema).min(1).max(20),
    remainingCount: z.number().int().nonnegative(),
  }).strict().nullable(),
  collectionDistribution: z.array(z.object({
    collectionId: uuidSchema,
    colorToken: collectionColorTokenSchema,
    placeCount: z.number().int().positive(),
  }).strict()).min(1).max(personalLibraryMapMaximumClusterSegmentsV4),
  remainingCollectionCount: z.number().int().nonnegative(),
}).strict().superRefine((feature, context) => {
  if (new Set(feature.collectionDistribution.map((item) => item.collectionId)).size !== feature.collectionDistribution.length ||
      feature.collectionDistribution.some((item) => item.placeCount > feature.count)) {
    context.addIssue({ code: 'custom', message: 'Cluster distribution must contain unique bounded Collection counts' })
  }
  if (feature.coincidentPreview === null) return
  const preview = feature.coincidentPreview
  if (preview.places.length + preview.remainingCount !== feature.count ||
      new Set(preview.places.map((place) => place.placeId)).size !== preview.places.length ||
      preview.places.some((place) => place.location.latitude !== feature.location.latitude ||
        place.location.longitude !== feature.location.longitude)) {
    context.addIssue({ code: 'custom', message: 'Coincident preview must represent unique places at this coordinate with an exact remainder' })
  }
})

export const personalLibraryMapFeatureV4Schema = z.discriminatedUnion('kind', [
  personalLibraryMapPlaceFeatureV4Schema,
  personalLibraryMapClusterFeatureV4Schema,
])

export const personalLibraryMapResponseV4Schema = z.object({
  schemaVersion: z.literal('personal-library-map.v4'),
  selection: personalLibraryMapSelectionV4Schema,
  filter: z.object({
    placeQuery: librarySearchTextSchema.optional(),
    ratingFilter: personalLibraryRatingFilterV2Schema,
    tagIds: libraryTagIdsSchema,
    tagMatch: libraryTagMatchSchema,
    areaKeys: libraryAreaKeysSchema,
    taxonomyKeys: libraryTaxonomyKeysSchema,
  }).strict(),
  selectedCollections: z.array(personalLibraryMapCollectionV4Schema)
    .max(personalLibraryMapMaximumSelectedCollectionsV4),
  viewport: z.object({ bounds: mapViewportSchema, zoom: mapQueryZoomSchema }).strict(),
  features: z.array(personalLibraryMapFeatureV4Schema).max(500),
  coverage: z.object({
    representedPlaceCount: z.number().int().nonnegative(),
    unprojectedPlaceCount: z.number().int().nonnegative(),
    complete: z.boolean(),
  }).strict(),
}).strict().superRefine((projection, context) => {
  const selectedIds = projection.selectedCollections.map((collection) => collection.collectionId)
  const selected = new Set(selectedIds)
  if (selected.size !== selectedIds.length ||
      (projection.selection.kind === 'collections' && (
        selected.size !== projection.selection.collectionIds.length ||
        projection.selection.collectionIds.some((collectionId) => !selected.has(collectionId))
      ))) {
    context.addIssue({ code: 'custom', message: 'Selected Collection metadata must exactly match the explicit selection' })
  }
  for (const feature of projection.features) {
    const memberships = feature.kind === 'place'
      ? feature.memberships
      : [
          ...feature.collectionDistribution.map((item) => ({ collectionId: item.collectionId })),
          ...(feature.coincidentPreview?.places.flatMap((place) => place.memberships) ?? []),
        ]
    if (memberships.some((membership) => !selected.has(membership.collectionId))) {
      context.addIssue({ code: 'custom', message: 'Map membership must belong to a selected Collection' })
      break
    }
  }
  const represented = projection.features.reduce(
    (count, feature) => count + (feature.kind === 'place' ? 1 : feature.count), 0,
  )
  if (represented !== projection.coverage.representedPlaceCount ||
      projection.coverage.complete !== (projection.coverage.unprojectedPlaceCount === 0)) {
    context.addIssue({ code: 'custom', message: 'Map coverage must match represented and unprojected places' })
  }
  const identifiers = projection.features.map((feature) => feature.kind === 'place' ? feature.placeId : feature.clusterId)
  if (new Set(identifiers).size !== identifiers.length) {
    context.addIssue({ code: 'custom', message: 'Map features must be unique' })
  }
})

export type CollectionColorToken = z.infer<typeof collectionColorTokenSchema>
export type CollectionColorCommandRequestV1 = z.infer<typeof collectionColorCommandRequestV1Schema>
export type CollectionColorCommandResultV1 = z.infer<typeof collectionColorCommandResultV1Schema>
export type PersonalLibraryMapCollectionV4 = z.infer<typeof personalLibraryMapCollectionV4Schema>
export type PersonalLibraryMapFeatureV4 = z.infer<typeof personalLibraryMapFeatureV4Schema>
export type PersonalLibraryMapRequestV4 = z.infer<typeof personalLibraryMapRequestV4Schema>
export type PersonalLibraryMapResponseV4 = z.infer<typeof personalLibraryMapResponseV4Schema>
export type PersonalLibraryMapSelectionV4 = z.infer<typeof personalLibraryMapSelectionV4Schema>
