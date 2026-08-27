import { z } from 'zod'

import { uuidSchema } from '../primitives.js'

const placeLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict()

const placeTaxonomySchema = z.object({
  key: z.string().min(1).max(128),
  label: z.string().min(1).max(160),
}).strict()

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

const placeSummaryFields = {
  placeId: uuidSchema,
  name: z.string().min(1).max(300),
  areaLabel: z.string().min(1).max(300).nullable(),
  location: placeLocationSchema,
  primaryTaxonomy: placeTaxonomySchema.nullable(),
  taxonomyKeys: z.array(z.string().min(1).max(128)).max(32),
  evidence: z.object({
    status: z.enum(['verified', 'unverified', 'conflicted', 'stale']),
    projectedAt: z.iso.datetime({ offset: true }),
  }).strict(),
}

export const placeSummarySchema = z.object(placeSummaryFields).strict()

export const placeDetailResponseSchema = z.object({
  schemaVersion: z.literal('place-detail.v1'),
  status: z.enum(['available', 'redirected']),
  requestedPlaceId: uuidSchema,
  redirectedFrom: z.array(uuidSchema).max(32),
  ...placeSummaryFields,
  personalState: placeDetailPersonalStateSchema.optional(),
}).strict()

export type PlaceSummary = z.infer<typeof placeSummarySchema>
export type PlaceDetailPersonalState = z.infer<typeof placeDetailPersonalStateSchema>
export type PlaceDetailResponse = z.infer<typeof placeDetailResponseSchema>
