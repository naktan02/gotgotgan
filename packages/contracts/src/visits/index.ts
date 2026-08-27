import { z } from 'zod'

import { uuidSchema } from '../primitives.js'

const cursorSchema = z.string().min(1).max(2_048)

export const visitHistoryQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const visitHistoryResponseSchema = z.object({
  schemaVersion: z.literal('visit-history.v1'),
  placeId: uuidSchema,
  items: z.array(z.object({
    visitId: uuidSchema,
    visitedAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
  }).strict()).max(50),
  nextCursor: cursorSchema.optional(),
}).strict()

export const visitRecordResultSchema = z.object({
  schemaVersion: z.literal('visit-record-result.v1'),
  status: z.literal('recorded'),
}).strict()

export const visitSummaryResponseSchema = z.discriminatedUnion('visited', [
  z.object({
    schemaVersion: z.literal('visit-summary.v1'),
    placeId: uuidSchema,
    visited: z.literal(false),
    count: z.literal(0),
  }).strict(),
  z.object({
    schemaVersion: z.literal('visit-summary.v1'),
    placeId: uuidSchema,
    visited: z.literal(true),
    count: z.number().int().positive(),
    firstVisitedAt: z.iso.datetime({ offset: true }),
    lastVisitedAt: z.iso.datetime({ offset: true }),
  }).strict(),
])

export type VisitHistoryQuery = z.infer<typeof visitHistoryQuerySchema>
export type VisitHistoryResponse = z.infer<typeof visitHistoryResponseSchema>
export type VisitRecordResult = z.infer<typeof visitRecordResultSchema>
export type VisitSummaryResponse = z.infer<typeof visitSummaryResponseSchema>
