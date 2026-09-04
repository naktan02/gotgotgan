import { z } from 'zod'

import { uuidSchema } from '../primitives.js'

export const libraryCursorSchema = z.string().min(1).max(2_048)
export const libraryPageLimitSchema = z.coerce.number().int().min(1).max(50).default(20)
export const libraryTagIdsSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(uuidSchema).max(20).refine(
    (tagIds) => new Set(tagIds).size === tagIds.length,
    'tagIds must be unique',
  ).transform((tagIds) => [...tagIds].sort()),
)
export const libraryAreaFacetKeySchema = z.string().regex(/^area_[A-Za-z0-9_-]{22}$/)
export const libraryTaxonomyFacetKeySchema = z.string().min(1).max(128)
export const libraryAreaKeysSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(libraryAreaFacetKeySchema).max(10).refine(
    (keys) => new Set(keys).size === keys.length,
    'areaKeys must be unique',
  ).transform((keys) => [...keys].sort()),
)
export const libraryTaxonomyKeysSchema = z.preprocess(
  (value) => value === undefined ? [] : typeof value === 'string' ? [value] : value,
  z.array(libraryTaxonomyFacetKeySchema).max(10).refine(
    (keys) => new Set(keys).size === keys.length,
    'taxonomyKeys must be unique',
  ).transform((keys) => [...keys].sort()),
)

export const libraryPlaceStateSchema = z.enum(['saved', 'wanted', 'rated'])
export const libraryTagMatchSchema = z.enum(['all', 'any'])
export const libraryCollectionRevisionV2Schema = z.string().min(1).max(2_048)

export const libraryOperationReceiptV2Schema = z.object({
  commandId: uuidSchema,
  status: z.enum(['applied', 'replayed']),
}).strict()

export const libraryOperationRejectionV2Schema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('not-found') }).strict(),
  z.object({ code: z.literal('version-conflict') }).strict(),
  z.object({ code: z.literal('operation-id-reused') }).strict(),
  z.object({ code: z.literal('invalid-selection') }).strict(),
  z.object({ code: z.literal('anchor-not-found') }).strict(),
  z.object({ code: z.literal('source-membership-missing') }).strict(),
  z.object({
    code: z.literal('collection-limit-exceeded'),
    limit: z.number().int().positive().optional(),
  }).strict(),
  z.object({ code: z.literal('binding-version-conflict') }).strict(),
  z.object({ code: z.literal('publication-changed') }).strict(),
])

export type LibraryPlaceState = z.infer<typeof libraryPlaceStateSchema>
export type LibraryTagMatch = z.infer<typeof libraryTagMatchSchema>
export type LibraryCollectionRevisionV2 = z.infer<typeof libraryCollectionRevisionV2Schema>
export type LibraryOperationReceiptV2 = z.infer<typeof libraryOperationReceiptV2Schema>
export type LibraryOperationRejectionV2 = z.infer<typeof libraryOperationRejectionV2Schema>
