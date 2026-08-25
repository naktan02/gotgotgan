import { z } from 'zod'

import { uuidSchema } from '../http/content.js'

export const searchBoundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
}).strict().refine((bounds) => bounds.west < bounds.east && bounds.south < bounds.north, {
  message: 'Search bounds must describe a non-empty viewport.',
})

export const placeSearchRequestSchema = z.object({
  schemaVersion: z.literal('place-search.v1'),
  query: z.string().trim().max(200),
  bounds: searchBoundsSchema.optional(),
  filters: z.object({
    taxonomyKeys: z.array(z.string().min(1).max(128)).max(16).default([]),
    saved: z.boolean().optional(),
    wanted: z.boolean().optional(),
    visited: z.boolean().optional(),
    minimumPersonalRating: z.number().min(0.1).max(5).multipleOf(0.1).optional(),
  }).strict().default({ taxonomyKeys: [] }),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict()

export const searchPersonalStateSchema = z.object({
  saved: z.boolean(),
  wanted: z.boolean(),
  visited: z.boolean(),
  personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable(),
}).strict()

export const placeSearchResultSchema = z.object({
  placeId: uuidSchema,
  name: z.string().min(1).max(300),
  areaLabel: z.string().min(1).max(300).nullable(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict(),
  primaryTaxonomy: z.object({
    key: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  }).strict().nullable(),
  taxonomyKeys: z.array(z.string().min(1).max(128)).max(32),
  evidenceStatus: z.enum(['verified', 'unverified', 'conflicted', 'stale']),
  personalState: searchPersonalStateSchema.optional(),
}).strict()

export const searchSourceOutcomeSchema = z.object({
  sourceKey: z.string().min(1).max(64),
  status: z.enum(['complete', 'partial', 'unavailable']),
  resultCount: z.number().int().nonnegative(),
  errorCode: z.string().min(1).max(128).optional(),
}).strict()

export const taxonomyNodeSchema = z.object({
  key: z.string().min(1).max(128),
  parentKey: z.string().min(1).max(128).nullable(),
  label: z.string().min(1).max(160),
  kind: z.enum(['category', 'attribute']),
  version: z.number().int().positive(),
}).strict()

export const taxonomyProjectionSchema = z.object({
  schemaVersion: z.literal('place-taxonomy.v1'),
  nodes: z.array(taxonomyNodeSchema).max(2_000),
}).strict()

export const placeSearchResponseSchema = z.object({
  schemaVersion: z.literal('place-search.v1'),
  items: z.array(placeSearchResultSchema).max(50),
  nextCursor: z.string().min(1).max(2_048).optional(),
  sources: z.array(searchSourceOutcomeSchema).min(1).max(16),
}).strict()

export type SearchBounds = z.infer<typeof searchBoundsSchema>
export type PlaceSearchRequestInput = z.input<typeof placeSearchRequestSchema>
export type PlaceSearchRequest = z.infer<typeof placeSearchRequestSchema>
export type SearchPersonalState = z.infer<typeof searchPersonalStateSchema>
export type PlaceSearchResult = z.infer<typeof placeSearchResultSchema>
export type SearchSourceOutcome = z.infer<typeof searchSourceOutcomeSchema>
export type PlaceSearchResponse = z.infer<typeof placeSearchResponseSchema>
export type TaxonomyNode = z.infer<typeof taxonomyNodeSchema>
export type TaxonomyProjection = z.infer<typeof taxonomyProjectionSchema>
