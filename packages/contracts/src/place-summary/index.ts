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

export const placeSummaryFields = {
  placeId: uuidSchema,
  name: z.string().min(1).max(300),
  areaLabel: z.string().min(1).max(300).nullable(),
  location: placeLocationSchema.nullable(),
  primaryTaxonomy: placeTaxonomySchema.nullable(),
  taxonomyKeys: z.array(z.string().min(1).max(128)).max(32),
  evidence: z.object({
    status: z.enum(['verified', 'unverified', 'conflicted', 'stale']),
    projectedAt: z.iso.datetime({ offset: true }),
  }).strict(),
}

export const placeSummarySchema = z.object(placeSummaryFields).strict()

export type PlaceSummary = z.infer<typeof placeSummarySchema>
