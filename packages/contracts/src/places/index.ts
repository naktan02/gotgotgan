import { z } from 'zod'

import { placeSummaryFields } from '../place-summary/index.js'
import { uuidSchema } from '../primitives.js'

export { placeSummarySchema, type PlaceSummary } from '../place-summary/index.js'

const placeVisitSummarySchema = z.discriminatedUnion('visited', [
  z.object({ visited: z.literal(false), count: z.literal(0) }).strict(),
  z.object({
    visited: z.literal(true),
    count: z.number().int().positive(),
    firstVisitedAt: z.iso.datetime({ offset: true }),
    lastVisitedAt: z.iso.datetime({ offset: true }),
  }).strict(),
])

export const placeDetailPersonalStateSchema = z.object({
  saved: z.boolean(),
  wanted: z.boolean(),
  personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable(),
  preferencesUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  visits: placeVisitSummarySchema,
}).strict()

const placeDetailIdentityFields = {
  schemaVersion: z.literal('place-detail.v1'),
  requestedPlaceId: uuidSchema,
  placeId: uuidSchema,
  redirectedFrom: z.array(uuidSchema).max(32),
}

const publicPlaceDetailFields = {
  ...placeDetailIdentityFields,
  status: z.enum(['available', 'redirected']),
  ...placeSummaryFields,
}

export const publicPlaceDetailResponseSchema = z.object(publicPlaceDetailFields).strict()

export const placeDetailResponseSchema = z.discriminatedUnion('status', [
  z.object({
    ...publicPlaceDetailFields,
    personalState: placeDetailPersonalStateSchema.optional(),
  }).strict(),
  z.object({
    ...placeDetailIdentityFields,
    status: z.literal('pending'),
    personalState: placeDetailPersonalStateSchema,
  }).strict(),
])

export type PlaceDetailPersonalState = z.infer<typeof placeDetailPersonalStateSchema>
export type PlaceDetailResponse = z.infer<typeof placeDetailResponseSchema>
export type PublicPlaceDetailResponse = z.infer<typeof publicPlaceDetailResponseSchema>
