import { z } from 'zod'

import { placeSummarySchema } from '../places/index.js'
import { uuidSchema } from '../primitives.js'
import {
  libraryAreaFacetKeySchema,
  libraryAreaKeysSchema,
  libraryCollectionRevisionV2Schema,
  libraryCursorSchema,
  libraryOperationReceiptV2Schema,
  libraryOperationRejectionV2Schema,
  libraryPageLimitSchema,
  libraryTaxonomyFacetKeySchema,
  libraryTaxonomyKeysSchema,
} from './contract-primitives.js'

export const publicCollectionTopicV2Schema = z.object({
  key: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
  label: z.string().trim().min(1).max(80),
}).strict()

const publicCollectionTopicKeysV2Schema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(publicCollectionTopicV2Schema.shape.key).max(10).refine(
    (keys) => new Set(keys).size === keys.length,
    'topicKeys must be unique',
  ).transform((keys) => [...keys].sort()),
)

export const publicCollectionDirectoryQueryV2Schema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  areaKeys: libraryAreaKeysSchema,
  taxonomyKeys: libraryTaxonomyKeysSchema,
  topicKeys: publicCollectionTopicKeysV2Schema,
  sort: z.enum(['recent', 'largest', 'name']).default('recent'),
  cursor: libraryCursorSchema.optional(),
  limit: libraryPageLimitSchema,
}).strict()

const publicCollectionOwnerV2Schema = z.object({
  handle: z.string().min(3).max(30),
  displayName: z.string().min(1).max(50),
}).strict()

const publicCollectionPlaceV2Schema = z.object({
  placeId: uuidSchema,
  position: z.number().int().nonnegative(),
  place: placeSummarySchema.nullable(),
}).strict()

const publicCollectionDiscoveryFacetV2Schema = z.object({
  key: z.string().min(1).max(128),
  label: z.string().min(1).max(300),
  count: z.number().int().positive(),
}).strict()

const publicCollectionDiscoverySummaryV2Schema = z.object({
  publicationId: uuidSchema,
  publicationVersion: libraryCollectionRevisionV2Schema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  placeCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
  owner: publicCollectionOwnerV2Schema,
  topics: z.array(publicCollectionTopicV2Schema).max(8),
  previewPlaces: z.array(publicCollectionPlaceV2Schema).max(6),
}).strict()

export const publicCollectionDirectoryResponseV2Schema = z.object({
  schemaVersion: z.literal('public-collection-directory.v2'),
  filter: z.object({
    q: z.string().min(1).max(120).nullable(),
    areaKeys: z.array(libraryAreaFacetKeySchema).max(10),
    taxonomyKeys: z.array(libraryTaxonomyFacetKeySchema).max(10),
    topicKeys: z.array(publicCollectionTopicV2Schema.shape.key).max(10),
    sort: z.enum(['recent', 'largest', 'name']),
  }).strict(),
  items: z.array(publicCollectionDiscoverySummaryV2Schema).max(50),
  nextCursor: libraryCursorSchema.optional(),
  availableFilters: z.object({
    areas: z.array(publicCollectionDiscoveryFacetV2Schema.extend({
      key: libraryAreaFacetKeySchema,
    })).max(50),
    taxonomies: z.array(publicCollectionDiscoveryFacetV2Schema.extend({
      key: libraryTaxonomyFacetKeySchema,
      label: z.string().min(1).max(160),
    })).max(50),
    topics: z.array(publicCollectionDiscoveryFacetV2Schema.extend({
      key: publicCollectionTopicV2Schema.shape.key,
      label: z.string().min(1).max(80),
    })).max(50),
  }).strict(),
}).strict()

export const discoverableCollectionParamsV2Schema = z.object({
  publicationId: uuidSchema,
}).strict()

export const discoverableCollectionQueryV2Schema = z.object({
  cursor: libraryCursorSchema.optional(),
  limit: libraryPageLimitSchema,
}).strict()

export const discoverableCollectionResponseV2Schema = z.object({
  schemaVersion: z.literal('discoverable-collection.v2'),
  publicationId: uuidSchema,
  publicationVersion: libraryCollectionRevisionV2Schema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  placeCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
  owner: publicCollectionOwnerV2Schema,
  topics: z.array(publicCollectionTopicV2Schema).max(8),
  places: z.array(publicCollectionPlaceV2Schema).max(50),
  nextCursor: libraryCursorSchema.optional(),
}).strict()

const publishedCollectionCopyTargetV2Schema = z.object({
  collectionId: uuidSchema,
  name: z.string().trim().min(1).max(120),
}).strict()

const publishedCollectionCopySelectionV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({
    kind: z.literal('places'),
    placeIds: z.array(uuidSchema).min(1).max(500).refine(
      (placeIds) => new Set(placeIds).size === placeIds.length,
      'placeIds must be unique',
    ),
  }).strict(),
])

export const publishedCollectionCopyCommandRequestV2Schema = z.object({
  schemaVersion: z.literal('published-collection-copy-command.v2'),
  commandId: uuidSchema,
  sourcePublicationId: uuidSchema,
  expectedPublicationVersion: libraryCollectionRevisionV2Schema,
  target: publishedCollectionCopyTargetV2Schema,
  selection: publishedCollectionCopySelectionV2Schema,
}).strict()

export const publishedCollectionCopyCommandResultV2Schema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal('published-collection-copy-command-result.v2'),
    outcome: z.literal('accepted'),
    receipt: libraryOperationReceiptV2Schema,
    collectionId: uuidSchema,
    collectionRevision: libraryCollectionRevisionV2Schema,
    copiedPlaceCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    schemaVersion: z.literal('published-collection-copy-command-result.v2'),
    outcome: z.literal('rejected'),
    commandId: uuidSchema,
    rejection: libraryOperationRejectionV2Schema,
  }).strict(),
])

export type PublicCollectionTopicV2 = z.infer<typeof publicCollectionTopicV2Schema>
export type PublicCollectionDirectoryQueryV2 = z.infer<typeof publicCollectionDirectoryQueryV2Schema>
export type PublicCollectionDirectoryResponseV2 = z.infer<
  typeof publicCollectionDirectoryResponseV2Schema
>
export type DiscoverableCollectionQueryV2 = z.infer<typeof discoverableCollectionQueryV2Schema>
export type DiscoverableCollectionResponseV2 = z.infer<typeof discoverableCollectionResponseV2Schema>
export type PublishedCollectionCopyCommandRequestV2 = z.infer<
  typeof publishedCollectionCopyCommandRequestV2Schema
>
export type PublishedCollectionCopyCommandResultV2 = z.infer<
  typeof publishedCollectionCopyCommandResultV2Schema
>
