import { z } from 'zod'

import { uuidSchema } from '../primitives.js'
import { providerKeySchema } from '../providers/index.js'

export const importBatchStateSchema = z.enum([
  'queued',
  'running',
  'partial',
  'enriching',
  'needs-user-action',
  'needs-review',
  'completed',
  'failed',
  'cancelled',
])

export const importFailureCodeSchema = z.enum([
  'provider-auth-expired',
  'provider-mfa-required',
  'provider-captcha-required',
  'provider-consent-required',
  'provider-rate-limited',
  'provider-parser-drift',
  'provider-unavailable',
  'capture-invalid',
  'internal-failure',
])

export const providerConnectionProjectionSchema = z.object({
  schemaVersion: z.literal('place-provider-connection.v1'),
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  label: z.string().min(1).max(120),
  status: z.enum(['ready', 'action-required', 'revoked']),
  lastVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict()

export const providerConnectionListSchema = z.object({
  schemaVersion: z.literal('place-provider-connections.v1'),
  items: z.array(providerConnectionProjectionSchema).max(20),
}).strict()

export const placeImportRequestSchema = z.object({
  schemaVersion: z.literal('place-import-request.v1'),
  connectionId: uuidSchema,
  idempotencyKey: uuidSchema,
}).strict()

export const importProgressSchema = z.object({
  discovered: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  reviewRequired: z.number().int().nonnegative(),
  enriching: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict()

export const placeImportBatchSchema = z.object({
  schemaVersion: z.literal('place-import-batch.v1'),
  batchId: uuidSchema,
  connectionId: uuidSchema,
  providerKey: providerKeySchema,
  state: importBatchStateSchema,
  progress: importProgressSchema,
  failure: z.object({
    code: importFailureCodeSchema,
    retryable: z.boolean(),
  }).strict().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()

const cursorSchema = z.string().min(1).max(2_048)
export const importBatchStateFilterSchema = z.union([
  z.literal('all'),
  importBatchStateSchema,
])

export const placeImportBatchListQuerySchema = z.object({
  state: importBatchStateFilterSchema.default('all'),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const placeImportBatchIdentifierParamsSchema = z.object({
  batchId: uuidSchema,
}).strict()

export const placeImportBatchDetailQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
}).strict()

export const placeImportBatchListSchema = z.object({
  schemaVersion: z.literal('place-import-batch-list.v1'),
  filter: z.object({ state: importBatchStateFilterSchema }).strict(),
  items: z.array(placeImportBatchSchema).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const placeImportItemSchema = z.object({
  schemaVersion: z.literal('place-import-item.v1'),
  itemId: uuidSchema,
  batchId: uuidSchema,
  providerKey: providerKeySchema,
  providerPlaceId: z.string().min(1).max(512).optional(),
  sourceListId: z.string().min(1).max(512),
  sourceItemId: z.string().min(1).max(512),
  listName: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  address: z.string().min(1).max(500).nullable(),
  categoryLabel: z.string().min(1).max(300).nullable(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().nullable(),
  status: z.enum(['enriching', 'ready', 'needs-review', 'applied', 'skipped', 'failed']),
  reviewReasons: z.array(z.string().min(1).max(120)).max(10),
  canonicalPlaceId: uuidSchema.optional(),
  detailStatus: z.enum(['pending', 'available', 'unavailable']),
}).strict()

export const placeImportBatchDetailSchema = z.object({
  schemaVersion: z.literal('place-import-batch-detail.v1'),
  batch: placeImportBatchSchema,
  items: z.array(placeImportItemSchema).max(200),
  nextCursor: cursorSchema.optional(),
}).strict()

export const placeImportCancelRequestSchema = z.object({
  schemaVersion: z.literal('place-import-cancel.v1'),
}).strict()

export const placeImportResumeRequestSchema = z.object({
  schemaVersion: z.literal('place-import-resume.v1'),
}).strict()

const reviewActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create-place') }).strict(),
  z.object({ kind: z.literal('link-place'), canonicalPlaceId: uuidSchema }).strict(),
  z.object({ kind: z.literal('skip'), reason: z.string().min(1).max(300).optional() }).strict(),
])

export const placeImportReviewRequestSchema = z.object({
  schemaVersion: z.literal('place-import-review.v1'),
  commandId: uuidSchema,
  itemId: uuidSchema,
  action: reviewActionSchema,
}).strict()

export const placeImportReviewResultSchema = z.object({
  schemaVersion: z.literal('place-import-review-result.v1'),
  commandId: uuidSchema,
  itemId: uuidSchema,
  status: z.enum(['applied', 'skipped', 'replayed']),
  canonicalPlaceId: uuidSchema.optional(),
}).strict()

export type ImportBatchState = z.infer<typeof importBatchStateSchema>
export type ImportBatchStateFilter = z.infer<typeof importBatchStateFilterSchema>
export type ImportFailureCode = z.infer<typeof importFailureCodeSchema>
export type ProviderConnectionProjection = z.infer<typeof providerConnectionProjectionSchema>
export type PlaceImportRequest = z.infer<typeof placeImportRequestSchema>
export type PlaceImportBatch = z.infer<typeof placeImportBatchSchema>
export type PlaceImportBatchList = z.infer<typeof placeImportBatchListSchema>
export type PlaceImportBatchDetailQuery = z.infer<typeof placeImportBatchDetailQuerySchema>
export type PlaceImportItem = z.infer<typeof placeImportItemSchema>
export type PlaceImportBatchDetail = z.infer<typeof placeImportBatchDetailSchema>
export type PlaceImportReviewRequest = z.infer<typeof placeImportReviewRequestSchema>
export type PlaceImportReviewResult = z.infer<typeof placeImportReviewResultSchema>
