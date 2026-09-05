import { z } from 'zod'

import { placeSummarySchema } from '../places/index.js'
import { uuidSchema } from '../primitives.js'
import { personalLibraryOverlayV2Schema, personalLibraryCollectionSummaryV2Schema } from './workspace.js'
import {
  libraryAreaFacetKeySchema as areaFacetKeySchema,
  libraryAreaKeysSchema as areaKeysSchema,
  libraryCollectionRevisionV2Schema,
  libraryCursorSchema as cursorSchema,
  libraryOperationReceiptV2Schema,
  libraryOperationRejectionV2Schema,
  libraryPageLimitSchema as pageLimitSchema,
  libraryPlaceStateSchema,
  libraryPlaceFacetSchema,
  libraryTagIdsSchema as tagIdsSchema,
  libraryTagMatchSchema,
  libraryTaxonomyFacetKeySchema as taxonomyFacetKeySchema,
  libraryTaxonomyKeysSchema as taxonomyKeysSchema,
} from './contract-primitives.js'

export {
  libraryCollectionRevisionV2Schema,
  libraryOperationReceiptV2Schema,
  libraryOperationRejectionV2Schema,
  libraryPlaceStateSchema,
  libraryTagMatchSchema,
} from './contract-primitives.js'
export type {
  LibraryCollectionRevisionV2,
  LibraryOperationReceiptV2,
  LibraryOperationRejectionV2,
  LibraryPlaceState,
  LibraryTagMatch,
} from './contract-primitives.js'
export * from './map.js'
export * from './workspace.js'
export * from './public-collections.js'

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

export const collectionLifecycleCommandRequestV2Schema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal('collection-lifecycle-command.v2'),
    kind: z.literal('create'),
    commandId: uuidSchema,
    collectionId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2_000).nullable().default(null),
  }).strict(),
  z.object({
    schemaVersion: z.literal('collection-lifecycle-command.v2'),
    kind: z.literal('update'),
    commandId: uuidSchema,
    collectionId: uuidSchema,
    expectedCollectionRevision: libraryCollectionRevisionV2Schema,
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(2_000).nullable().optional(),
    visibility: z.enum(['private', 'unlisted', 'public']).optional(),
  }).strict().refine(
    (command) => command.name !== undefined || command.description !== undefined ||
      command.visibility !== undefined,
    'an update must change at least one Collection field',
  ),
  z.object({
    schemaVersion: z.literal('collection-lifecycle-command.v2'),
    kind: z.literal('delete'),
    commandId: uuidSchema,
    collectionId: uuidSchema,
    expectedCollectionRevision: libraryCollectionRevisionV2Schema,
  }).strict(),
])

export const collectionLifecycleCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('collection-lifecycle-command-result.v2'),
    outcome: z.literal('accepted'),
    receipt: libraryOperationReceiptV2Schema,
    collection: personalLibraryCollectionSummaryV2Schema.nullable(),
  }).strict(),
  z.object({
    schemaVersion: z.literal('collection-lifecycle-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: libraryOperationRejectionV2Schema,
  }).strict(),
])

export type LibraryPlacePreferencesResponse = z.infer<typeof libraryPlacePreferencesResponseSchema>
export type LibraryCommandResult = z.infer<typeof libraryCommandResultSchema>
export type LibraryPlaceListQuery = z.infer<typeof libraryPlaceListQuerySchema>
export type LibraryPlaceListResponse = z.infer<typeof libraryPlaceListResponseSchema>
export type LibraryPlaceFacetsResponse = z.infer<typeof libraryPlaceFacetsResponseSchema>
export type LibraryPlaceFacetsQuery = z.infer<typeof libraryPlaceFacetsQuerySchema>
export type LibraryCollectionListQuery = z.infer<typeof libraryCollectionListQuerySchema>
export type LibraryCollectionListResponse = z.infer<typeof libraryCollectionListResponseSchema>
export type LibraryCollectionDetailQuery = z.infer<typeof libraryCollectionDetailQuerySchema>
export type LibraryCollectionDetailResponse = z.infer<typeof libraryCollectionDetailResponseSchema>
export type LibraryTagListQuery = z.infer<typeof libraryTagListQuerySchema>
export type LibraryTagListResponse = z.infer<typeof libraryTagListResponseSchema>
export type LibraryPlaceOrganizationQuery = z.infer<typeof libraryPlaceOrganizationQuerySchema>
export type LibraryPlaceOrganizationResponse = z.infer<typeof libraryPlaceOrganizationResponseSchema>
export type PersonalLibraryOverlayV2 = z.infer<typeof personalLibraryOverlayV2Schema>
export type PersonalLibraryCollectionSummaryV2 = z.infer<typeof personalLibraryCollectionSummaryV2Schema>
export type PlaceFilingRequestV2 = z.infer<typeof placeFilingRequestV2Schema>
export type PlaceFilingResponseV2 = z.infer<typeof placeFilingResponseV2Schema>
export type PlaceFilingDesiredStateV2 = z.infer<typeof placeFilingDesiredStateV2Schema>
export type PlaceFilingCommandRequestV2 = z.infer<typeof placeFilingCommandRequestV2Schema>
export type PlaceFilingCommandResultV2 = z.infer<typeof placeFilingCommandResultV2Schema>
export type CollectionOrderAnchorV2 = z.infer<typeof collectionOrderAnchorV2Schema>
export type CollectionOrderCommandRequestV2 = z.infer<typeof collectionOrderCommandRequestV2Schema>
export type CollectionOrderCommandResultV2 = z.infer<typeof collectionOrderCommandResultV2Schema>
export type CollectionLifecycleCommandRequestV2 = z.infer<typeof collectionLifecycleCommandRequestV2Schema>
export type CollectionLifecycleCommandResultV2 = z.infer<typeof collectionLifecycleCommandResultV2Schema>
