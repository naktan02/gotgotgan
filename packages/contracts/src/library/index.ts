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

export const libraryPlaceStateSchema = z.enum(['saved', 'wanted', 'rated'])
export const libraryTagMatchSchema = z.enum(['all', 'any'])

export const libraryPlaceListQuerySchema = z.object({
  state: libraryPlaceStateSchema.default('saved'),
  tagIds: tagIdsSchema,
  tagMatch: libraryTagMatchSchema.default('all'),
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

export const libraryCollectionIdentifierParamsSchema = z.object({
  collectionId: uuidSchema,
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
  schemaVersion: z.literal('library-place-list.v2'),
  filter: z.object({
    state: libraryPlaceStateSchema,
    tagIds: z.array(uuidSchema).max(20),
    tagMatch: libraryTagMatchSchema,
  }).strict(),
  items: z.array(z.object({
    placeId: uuidSchema,
    ...preferenceFields,
    place: placeSummarySchema.nullable(),
  }).strict()).max(50),
  nextCursor: cursorSchema.optional(),
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

export type LibraryPlaceState = z.infer<typeof libraryPlaceStateSchema>
export type LibraryTagMatch = z.infer<typeof libraryTagMatchSchema>
export type LibraryPlacePreferencesResponse = z.infer<typeof libraryPlacePreferencesResponseSchema>
export type LibraryCommandResult = z.infer<typeof libraryCommandResultSchema>
export type LibraryPlaceListQuery = z.infer<typeof libraryPlaceListQuerySchema>
export type LibraryPlaceListResponse = z.infer<typeof libraryPlaceListResponseSchema>
export type LibraryCollectionListQuery = z.infer<typeof libraryCollectionListQuerySchema>
export type LibraryCollectionListResponse = z.infer<typeof libraryCollectionListResponseSchema>
export type LibraryCollectionDetailQuery = z.infer<typeof libraryCollectionDetailQuerySchema>
export type LibraryCollectionDetailResponse = z.infer<typeof libraryCollectionDetailResponseSchema>
export type LibraryTagListQuery = z.infer<typeof libraryTagListQuerySchema>
export type LibraryTagListResponse = z.infer<typeof libraryTagListResponseSchema>
