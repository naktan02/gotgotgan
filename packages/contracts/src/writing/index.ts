import { z } from 'zod'

import { uuidSchema } from '../primitives.js'

const cursorSchema = z.string().min(1).max(2_048)
const visibilitySchema = z.enum(['private', 'unlisted', 'public'])

export const writingKindFilterSchema = z.enum(['all', 'note', 'entry'])

export const writingListQuerySchema = z.object({
  kind: writingKindFilterSchema.default('all'),
  placeId: uuidSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const writingDocumentIdentifierParamsSchema = z.object({
  documentId: uuidSchema,
}).strict()

const writingSummaryCommon = {
  documentId: uuidSchema,
  bodyPreview: z.string().min(1).max(280),
  bodyTruncated: z.boolean(),
  visibility: visibilitySchema,
  publicationId: uuidSchema.nullable(),
  version: z.number().int().positive(),
  placeIds: z.array(uuidSchema).min(1).max(32),
  updatedAt: z.iso.datetime({ offset: true }),
}

export const writingSummarySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('note'),
    title: z.null(),
    ...writingSummaryCommon,
  }).strict(),
  z.object({
    kind: z.literal('entry'),
    title: z.string().min(1).max(200),
    ...writingSummaryCommon,
  }).strict(),
])

export const writingListResponseSchema = z.object({
  schemaVersion: z.literal('writing-list.v1'),
  filter: z.object({
    kind: writingKindFilterSchema,
    placeId: uuidSchema.optional(),
  }).strict(),
  items: z.array(writingSummarySchema).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

const writingDetailCommon = {
  documentId: uuidSchema,
  body: z.string().min(1).max(100_000),
  visibility: visibilitySchema,
  publicationId: uuidSchema.nullable(),
  version: z.number().int().positive(),
  placeIds: z.array(uuidSchema).min(1).max(32),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}

export const writingDocumentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('note'),
    title: z.null(),
    ...writingDetailCommon,
  }).strict(),
  z.object({
    kind: z.literal('entry'),
    title: z.string().min(1).max(200),
    ...writingDetailCommon,
  }).strict(),
])

export const writingDetailResponseSchema = z.object({
  schemaVersion: z.literal('writing-detail.v1'),
  document: writingDocumentSchema,
}).strict()

export const writingCommandResultSchema = z.discriminatedUnion('status', [
  z.object({
    schemaVersion: z.literal('writing-command-result.v1'),
    status: z.literal('applied'),
    documentId: uuidSchema,
    version: z.number().int().positive(),
  }).strict(),
  z.object({
    schemaVersion: z.literal('writing-command-result.v1'),
    status: z.literal('replayed'),
  }).strict(),
])

export type WritingKindFilter = z.infer<typeof writingKindFilterSchema>
export type WritingListQuery = z.infer<typeof writingListQuerySchema>
export type WritingListResponse = z.infer<typeof writingListResponseSchema>
export type WritingDetailResponse = z.infer<typeof writingDetailResponseSchema>
export type WritingCommandResult = z.infer<typeof writingCommandResultSchema>
